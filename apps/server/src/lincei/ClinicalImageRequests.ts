/**
 * ClinicalImageRequests - agents asking for a cohort's images, and the
 * researcher signing in to fetch them.
 *
 * Imaging datasets such as MIMIC-CXR-JPG are far too large to download
 * whole, so their images are fetched for a cohort when an agent needs them,
 * mid-analysis. Fetching from a credentialed dataset needs the researcher's
 * PhysioNet login, which Lincei never stores and an agent must never see. So
 * an agent files a request here (MCP tool `lincei_clinical_fetch_images`),
 * the client shows it in the agent's thread and asks the researcher to sign
 * in, and the login goes with the answer straight to M4 for that one fetch
 * (ClinicalDatasets.fetchImages). The agent follows the request by id.
 *
 * Requests live in memory: a request outlives neither the server nor, once
 * finished, an hour. One dataset fetches for one request at a time, because
 * two fetches of the same files would write the same partial files.
 *
 * @module ClinicalImageRequests
 */
import type { ClinicalImageRequest, PhysioNetCredentials } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import * as ClinicalDatasets from "./ClinicalDatasets.ts";

/** More images than this in one request is a download to plan, not a fetch to wait for. */
export const MAX_IMAGES_PER_REQUEST = 1_000;
/** A cohort list larger than this is not a list of images. */
const MAX_LIST_BYTES = 10 * 1024 * 1024;
/** The columns M4 accepts to name an image. */
const IMAGE_COLUMNS = new Set(["dicom_id", "image_path", "path"]);
/** How long a finished request is still shown and can be read. */
const FINISHED_RETENTION_MS = 60 * 60 * 1000;

export class ClinicalImageRequestsError extends Schema.TaggedError<ClinicalImageRequestsError>()(
  "ClinicalImageRequestsError",
  {
    /** What went wrong and what to do next, in words for whoever asked: the agent or the user. */
    message: Schema.String,
    detail: Schema.optional(Schema.String),
  },
) {}

export class ClinicalImageRequests extends Context.Service<
  ClinicalImageRequests,
  {
    /**
     * Files an agent's request for the images `list` names, from `dataset`,
     * shown in the thread `threadId`. A dataset that needs no login is
     * fetched at once; otherwise the request waits for the researcher.
     */
    readonly request: (input: {
      readonly threadId: string;
      readonly dataset: string;
      readonly list: string;
    }) => Effect.Effect<ClinicalImageRequest, ClinicalImageRequestsError>;
    readonly get: (id: string) => Effect.Effect<Option.Option<ClinicalImageRequest>>;
    /** A thread's requests, oldest first: the open ones, and those finished within the hour. */
    readonly forThread: (threadId: string) => Effect.Effect<ReadonlyArray<ClinicalImageRequest>>;
    /** Starts fetching with the researcher's login, which nothing keeps. */
    readonly answer: (
      id: string,
      credentials: PhysioNetCredentials,
    ) => Effect.Effect<ClinicalImageRequest, ClinicalImageRequestsError>;
    readonly decline: (
      id: string,
    ) => Effect.Effect<ClinicalImageRequest, ClinicalImageRequestsError>;
  }
>()("t3/lincei/ClinicalImageRequests") {}

const notFound = () =>
  new ClinicalImageRequestsError({
    message:
      "This image request is no longer open. Lincei keeps requests until it restarts, and finished ones for an hour. Ask the agent to request the images again.",
  });

/** The header and the number of data rows of a CSV file. */
const readCohort = (text: string) => {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const header = (lines[0] ?? "")
    .replace(/^﻿/, "")
    .split(",")
    .map((column) => column.trim().replace(/^"|"$/g, "").toLowerCase());
  return { header, rows: Math.max(0, lines.length - 1) };
};

const make = Effect.gen(function* () {
  const datasets = yield* ClinicalDatasets.ClinicalDatasets;
  const crypto = yield* Crypto.Crypto;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const scope = yield* Effect.scope;

  /** Each request, with the cohort list it fetches. */
  const requests = new Map<string, ClinicalImageRequest & { readonly list: string }>();
  /** When each request finished, for forgetting it. */
  const finishedAt = new Map<string, number>();

  /** A request as clients and agents see it: without the path of its list. */
  const snapshot = (id: string) =>
    Option.match(Option.fromNullishOr(requests.get(id)), {
      onNone: () => Effect.fail(notFound()),
      onSome: ({ list: _list, ...request }) => Effect.succeed<ClinicalImageRequest>(request),
    });

  const set = (id: string, change: Partial<ClinicalImageRequest>) =>
    Effect.gen(function* () {
      const current = requests.get(id);
      if (current === undefined) return;
      const next = { ...current, ...change };
      requests.set(id, next);
      if (next.state === "done" || next.state === "declined" || next.state === "failed") {
        finishedAt.set(id, yield* Clock.currentTimeMillis);
      } else {
        finishedAt.delete(id);
      }
    });

  const forget = Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    for (const [id, at] of finishedAt) {
      if (now - at > FINISHED_RETENTION_MS) {
        finishedAt.delete(id);
        requests.delete(id);
      }
    }
  });

  /** Runs the fetch in the background, keeping the request's progress and outcome. */
  const startFetch = (id: string, credentials?: PhysioNetCredentials) =>
    Effect.gen(function* () {
      const request = requests.get(id);
      if (request === undefined) return;
      const name = request.datasetTitle ?? request.dataset;
      // What an earlier attempt reported is about that attempt.
      const { detail: _detail, total: _total, ...earlier } = request;
      requests.set(id, {
        ...earlier,
        state: "fetching",
        completed: 0,
        message: `Fetching ${request.images} images from ${name}.`,
      });
      finishedAt.delete(id);
      yield* datasets
        .fetchImages({
          name: request.dataset,
          list: request.list,
          credentials,
          onProgress: (progress) => {
            const current = requests.get(id);
            if (current === undefined || current.state !== "fetching") return;
            requests.set(id, {
              ...current,
              completed: progress.completed,
              ...(progress.total === undefined ? {} : { total: progress.total }),
            });
          },
        })
        .pipe(
          Effect.matchEffect({
            onSuccess: () =>
              set(id, {
                state: "done",
                completed: request.images,
                message: `The ${request.images} images from ${name} are on this computer.`,
              }),
            onFailure: (error) =>
              set(id, {
                state: "failed",
                message: error.message,
                ...(error.detail === undefined ? {} : { detail: error.detail }),
              }),
          }),
          Effect.forkIn(scope),
        );
    });

  const fetchingDataset = (dataset: string) =>
    [...requests.values()].some(
      (request) => request.dataset === dataset && request.state === "fetching",
    );

  const request: ClinicalImageRequests["Service"]["request"] = (input) =>
    Effect.gen(function* () {
      yield* forget;
      const list = input.list.trim();
      if (!path.isAbsolute(list) || path.extname(list).toLowerCase() !== ".csv") {
        return yield* new ClinicalImageRequestsError({
          message:
            "Pass the full path of a .csv file that lists the cohort's images, one row per image with a dicom_id (or image_path) column.",
        });
      }
      const info = yield* fileSystem
        .stat(list)
        .pipe(
          Effect.mapError(
            () => new ClinicalImageRequestsError({ message: `There is no file at ${list}.` }),
          ),
        );
      if (info.type !== "File" || Number(info.size) > MAX_LIST_BYTES) {
        return yield* new ClinicalImageRequestsError({
          message: `${list} is not a cohort list: it must be a CSV file of at most 10 MB.`,
        });
      }
      const cohort = readCohort(
        yield* fileSystem
          .readFileString(list)
          .pipe(
            Effect.mapError(
              () => new ClinicalImageRequestsError({ message: `Lincei could not read ${list}.` }),
            ),
          ),
      );
      if (!cohort.header.some((column) => IMAGE_COLUMNS.has(column))) {
        return yield* new ClinicalImageRequestsError({
          message: `${list} has no dicom_id or image_path column, so it names no images.`,
        });
      }
      if (cohort.rows === 0 || cohort.rows > MAX_IMAGES_PER_REQUEST) {
        return yield* new ClinicalImageRequestsError({
          message:
            cohort.rows === 0
              ? `${list} lists no images.`
              : `${list} lists ${cohort.rows} images; one request fetches at most ${MAX_IMAGES_PER_REQUEST}. Split the cohort, or ask the user whether a sample will do: PhysioNet sends images slowly, often a few hundred an hour.`,
        });
      }
      const listed = yield* datasets.list.pipe(
        Effect.mapError(
          (error) =>
            new ClinicalImageRequestsError({
              message: error.message,
              ...(error.detail === undefined ? {} : { detail: error.detail }),
            }),
        ),
      );
      const dataset = listed.find((candidate) => candidate.name === input.dataset);
      if (dataset === undefined) {
        return yield* new ClinicalImageRequestsError({
          message: `There is no dataset called "${input.dataset.slice(0, 60)}". Use M4's name for it, as m4.list_datasets() reports.`,
        });
      }

      // A newer request from the thread for the same dataset replaces one still waiting.
      for (const [id, earlier] of requests) {
        if (
          earlier.threadId === input.threadId &&
          earlier.dataset === dataset.name &&
          earlier.state === "waiting-for-login"
        ) {
          requests.delete(id);
        }
      }

      const id = (yield* crypto.randomUUIDv4().pipe(Effect.orDie)).slice(0, 12);
      const name = dataset.title ?? dataset.name;
      requests.set(id, {
        id,
        threadId: input.threadId,
        dataset: dataset.name,
        ...(dataset.title === undefined ? {} : { datasetTitle: dataset.title }),
        images: cohort.rows,
        state: "waiting-for-login",
        completed: 0,
        message: `Waiting for you to sign in with PhysioNet to fetch ${cohort.rows} images from ${name}.`,
        ...(dataset.agreementUrl === undefined ? {} : { agreementUrl: dataset.agreementUrl }),
        requestedAt: yield* Clock.currentTimeMillis,
        list,
      });
      if (!dataset.requiresCredentials) {
        if (fetchingDataset(dataset.name)) {
          requests.delete(id);
          return yield* new ClinicalImageRequestsError({
            message: `Images from ${name} are being fetched for another request. Ask again when that has finished.`,
          });
        }
        yield* startFetch(id);
        return yield* snapshot(id);
      }
      // M4 is asked without a login first: it only reads the disk then, and
      // the researcher is asked only for images that are not here yet.
      const asked = yield* Effect.exit(datasets.fetchImages({ name: dataset.name, list }));
      if (asked._tag === "Success") {
        yield* set(id, {
          state: "done",
          completed: cohort.rows,
          message: `All ${cohort.rows} images from ${name} are already on this computer.`,
        });
        return yield* snapshot(id);
      }
      const refusal = Cause.findErrorOption(asked.cause);
      if (Option.isSome(refusal) && refusal.value.code === "missing_credentials") {
        return yield* snapshot(id);
      }
      requests.delete(id);
      return yield* new ClinicalImageRequestsError({
        message: Option.match(refusal, {
          onNone: () => `Lincei could not check which images from ${name} are here. Try again.`,
          onSome: (error) => error.message,
        }),
        ...Option.match(refusal, {
          onNone: () => ({}),
          onSome: (error) => (error.detail === undefined ? {} : { detail: error.detail }),
        }),
      });
    });

  const get: ClinicalImageRequests["Service"]["get"] = (id) =>
    Effect.andThen(forget, Effect.option(snapshot(id)));

  const forThread: ClinicalImageRequests["Service"]["forThread"] = (threadId) =>
    Effect.map(forget, () =>
      [...requests.values()]
        .filter((request) => request.threadId === threadId)
        .toSorted((a, b) => a.requestedAt - b.requestedAt)
        .map(({ list: _list, ...request }): ClinicalImageRequest => request),
    );

  const answer: ClinicalImageRequests["Service"]["answer"] = (id, credentials) =>
    Effect.gen(function* () {
      const current = requests.get(id);
      if (current === undefined) return yield* notFound();
      // A failed fetch can be signed in to again, for a mistyped password.
      if (current.state !== "waiting-for-login" && current.state !== "failed") {
        return yield* new ClinicalImageRequestsError({
          message:
            current.state === "fetching"
              ? "These images are already being fetched."
              : "This image request is closed. Ask the agent to request the images again.",
        });
      }
      if (fetchingDataset(current.dataset)) {
        return yield* new ClinicalImageRequestsError({
          message: `Images from ${current.datasetTitle ?? current.dataset} are being fetched for another request. Sign in again when that has finished.`,
        });
      }
      yield* startFetch(id, credentials);
      return yield* snapshot(id);
    });

  const decline: ClinicalImageRequests["Service"]["decline"] = (id) =>
    Effect.gen(function* () {
      const current = requests.get(id);
      if (current === undefined) return yield* notFound();
      if (current.state === "fetching" || current.state === "done") {
        return yield* new ClinicalImageRequestsError({
          message: "These images are already being fetched or are here.",
        });
      }
      yield* set(id, { state: "declined", message: "You declined to fetch these images." });
      return yield* snapshot(id);
    });

  return ClinicalImageRequests.of({ request, get, forThread, answer, decline });
});

export const layer = Layer.effect(ClinicalImageRequests, make);
