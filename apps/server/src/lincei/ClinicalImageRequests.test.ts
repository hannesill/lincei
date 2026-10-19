import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import type { ClinicalDataset, ClinicalDatasetJob, PhysioNetCredentials } from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Queue from "effect/Queue";
import * as Redacted from "effect/Redacted";
import type * as Scope from "effect/Scope";

import * as ClinicalDatasets from "./ClinicalDatasets.ts";
import * as ClinicalImageRequests from "./ClinicalImageRequests.ts";

const CXR: ClinicalDataset = {
  name: "mimic-cxr-jpg",
  title: "MIMIC-CXR-JPG",
  state: "ready",
  requiresCredentials: true,
  downloadable: true,
  agreementUrl: "https://physionet.org/sign-dua/mimic-cxr-jpg/2.1.0/",
};
const OPEN: ClinicalDataset = {
  name: "cxr-demo",
  state: "ready",
  requiresCredentials: false,
  downloadable: true,
};

const LOGIN: PhysioNetCredentials = { username: "ada", password: Redacted.make("not-shown") };

interface Fetch {
  readonly name: string;
  readonly list: string;
  readonly credentials: PhysioNetCredentials | undefined;
  readonly report: (progress: ClinicalDatasetJob) => void;
  /** Ends the fetch: with nothing for success, or with the error M4's failure became. */
  readonly end: Deferred.Deferred<void, ClinicalDatasets.ClinicalDatasetsError>;
}

interface Bench {
  readonly requests: ClinicalImageRequests.ClinicalImageRequests["Service"];
  /** The next fetch to start, which runs until the test ends it. */
  readonly nextFetch: Effect.Effect<Fetch>;
  /**
   * Lets a fetch the test just ended record how it ended: the service does
   * that in its own fiber as soon as the fetch returns, ahead of this one.
   */
  readonly settle: Effect.Effect<void>;
  /** How many fetches have started, not counting M4 being asked without a login. */
  readonly fetchCount: () => number;
  /**
   * How M4 answers a credentialed dataset asked without a login: by default
   * that images are missing; `present` when all are on disk already.
   */
  readonly onDisk: (answer: "missing" | "present") => void;
  /** Writes a cohort list into a folder of its own and returns its path. */
  readonly cohort: (text: string) => Effect.Effect<string>;
  /**
   * From now on, M4 asked without a login answers only once the test lets
   * it, through the deferred `nextCheck` gives for each such call.
   */
  readonly holdChecks: () => void;
  readonly nextCheck: Effect.Effect<Deferred.Deferred<void>>;
  /** How many fetches were stopped before they ended. */
  readonly stopCount: () => number;
}

const withRequests = <A, E>(
  use: (bench: Bench) => Effect.Effect<A, E, FileSystem.FileSystem | Path.Path | Scope.Scope>,
) =>
  Effect.gen(function* () {
    const started = yield* Queue.unbounded<Fetch>();
    const checks = yield* Queue.unbounded<Deferred.Deferred<void>>();
    let fetchCount = 0;
    let stopCount = 0;
    let onDisk: "missing" | "present" = "missing";
    let holdChecks = false;
    type Service = ClinicalDatasets.ClinicalDatasets["Service"];
    // Only what the requests use; the rest of the service is never called.
    const fake: Pick<Service, "list" | "fetchImages"> = {
      list: Effect.succeed([CXR, OPEN]),
      fetchImages: (input) =>
        Effect.gen(function* () {
          // Without a login, M4 only reads the disk.
          if (input.name === CXR.name && input.credentials === undefined) {
            if (holdChecks) {
              const answered = yield* Deferred.make<void>();
              yield* Queue.offer(checks, answered);
              yield* Deferred.await(answered);
            }
            if (onDisk === "present") return;
            return yield* new ClinicalDatasets.ClinicalDatasetsError({
              message: "The PhysioNet login did not reach the fetch.",
              code: "missing_credentials",
            });
          }
          const end = yield* Deferred.make<void, ClinicalDatasets.ClinicalDatasetsError>();
          fetchCount += 1;
          yield* Queue.offer(started, {
            name: input.name,
            list: input.list,
            credentials: input.credentials,
            report: (progress) => input.onProgress?.(progress),
            end,
          });
          yield* Deferred.await(end).pipe(
            Effect.onInterrupt(() =>
              Effect.sync(() => {
                stopCount += 1;
              }),
            ),
          );
        }),
    };
    const datasets = Layer.succeed(
      ClinicalDatasets.ClinicalDatasets,
      ClinicalDatasets.ClinicalDatasets.of(fake as Service),
    );
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const folder = yield* fileSystem.makeTempDirectoryScoped({ prefix: "lincei-images-test-" });
    let written = 0;
    const cohort = (text: string) =>
      Effect.gen(function* () {
        const file = path.join(folder, `cohort-${written++}.csv`);
        yield* fileSystem.writeFileString(file, text).pipe(Effect.orDie);
        return file;
      });
    return yield* Effect.gen(function* () {
      const requests = yield* ClinicalImageRequests.ClinicalImageRequests;
      return yield* use({
        requests,
        nextFetch: Queue.take(started),
        settle: Effect.yieldNow,
        fetchCount: () => fetchCount,
        onDisk: (answer) => {
          onDisk = answer;
        },
        cohort,
        holdChecks: () => {
          holdChecks = true;
        },
        nextCheck: Queue.take(checks),
        stopCount: () => stopCount,
      });
    }).pipe(Effect.provide(ClinicalImageRequests.layer.pipe(Layer.provide(datasets))));
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer));

const COHORT = "dicom_id,subject_id\nd1,10000001\nd2,10000002\nd3,10000003\n";

describe("ClinicalImageRequests", () => {
  it.effect("waits for the researcher's login before fetching from a credentialed dataset", () =>
    withRequests(({ requests, fetchCount, cohort }) =>
      Effect.gen(function* () {
        const list = yield* cohort(COHORT);
        const request = yield* requests.request({
          threadId: "thread-1",
          dataset: "mimic-cxr-jpg",
          list,
        });
        expect(request).toMatchObject({
          threadId: "thread-1",
          dataset: "mimic-cxr-jpg",
          datasetTitle: "MIMIC-CXR-JPG",
          images: 3,
          state: "waiting-for-login",
          agreementUrl: CXR.agreementUrl,
        });
        // Nothing is fetched, and the list's path is not shown to anyone.
        expect(fetchCount()).toBe(0);
        expect(request).not.toHaveProperty("list");
        expect(yield* requests.forThread("thread-1")).toEqual([request]);
        expect(yield* requests.forThread("thread-2")).toEqual([]);
      }),
    ),
  );

  it.effect("fetches with the login it was answered with, and reports progress and the end", () =>
    withRequests(({ requests, nextFetch, settle, cohort }) =>
      Effect.gen(function* () {
        const list = yield* cohort(COHORT);
        const { id } = yield* requests.request({
          threadId: "thread-1",
          dataset: "mimic-cxr-jpg",
          list,
        });
        const answered = yield* requests.answer(id, LOGIN);
        expect(answered.state).toBe("fetching");
        const fetch = yield* nextFetch;
        expect(fetch).toMatchObject({ name: "mimic-cxr-jpg", credentials: LOGIN });
        expect(yield* (yield* FileSystem.FileSystem).readFileString(fetch.list)).toBe(COHORT);

        fetch.report({
          kind: "download",
          state: "running",
          phase: "downloading",
          completed: 2,
          total: 3,
          message: "",
        });
        expect(Option.getOrThrow(yield* requests.get(id))).toMatchObject({
          state: "fetching",
          completed: 2,
          total: 3,
        });

        yield* Deferred.succeed(fetch.end, undefined);
        yield* settle;
        expect(Option.getOrThrow(yield* requests.get(id))).toMatchObject({
          state: "done",
          completed: 3,
        });
      }),
    ),
  );

  it.effect("keeps why a fetch failed, and lets the researcher sign in to it again", () =>
    withRequests(({ requests, nextFetch, settle, cohort }) =>
      Effect.gen(function* () {
        const { id } = yield* requests.request({
          threadId: "thread-1",
          dataset: "mimic-cxr-jpg",
          list: yield* cohort(COHORT),
        });
        yield* requests.answer(id, LOGIN);
        const first = yield* nextFetch;
        yield* Deferred.fail(
          first.end,
          new ClinicalDatasets.ClinicalDatasetsError({
            message: "PhysioNet did not accept this username and password.",
            detail: "HTTP 401",
          }),
        );
        yield* settle;
        expect(Option.getOrThrow(yield* requests.get(id))).toMatchObject({
          state: "failed",
          message: "PhysioNet did not accept this username and password.",
          detail: "HTTP 401",
        });

        const again = yield* requests.answer(id, LOGIN);
        expect(again.state).toBe("fetching");
        expect(again).not.toHaveProperty("detail");
        expect((yield* nextFetch).credentials).toEqual(LOGIN);
      }),
    ),
  );

  it.effect("asks nobody when every image of a credentialed dataset is already here", () =>
    withRequests(({ requests, fetchCount, onDisk, cohort }) =>
      Effect.gen(function* () {
        onDisk("present");
        const request = yield* requests.request({
          threadId: "thread-1",
          dataset: "mimic-cxr-jpg",
          list: yield* cohort(COHORT),
        });
        expect(request).toMatchObject({
          state: "done",
          completed: 3,
          message: "All 3 images from MIMIC-CXR-JPG are already on this computer.",
        });
        expect(fetchCount()).toBe(0);
      }),
    ),
  );

  it.effect("fetches from a dataset that needs no login at once", () =>
    withRequests(({ requests, nextFetch, cohort }) =>
      Effect.gen(function* () {
        const request = yield* requests.request({
          threadId: "thread-1",
          dataset: "cxr-demo",
          list: yield* cohort(COHORT),
        });
        expect(request.state).toBe("fetching");
        expect((yield* nextFetch).credentials).toBeUndefined();
      }),
    ),
  );

  it.effect("tells the agent what is wrong with a request before anyone is asked", () =>
    withRequests(({ requests, cohort }) =>
      Effect.gen(function* () {
        const refusal = (input: { readonly dataset: string; readonly list: string }) =>
          requests.request({ threadId: "thread-1", ...input }).pipe(
            Effect.flip,
            Effect.map((error) => error.message),
          );
        expect(yield* refusal({ dataset: "mimic-cxr-jpg", list: "cohort.csv" })).toContain(
          "full path",
        );
        expect(
          yield* refusal({ dataset: "mimic-cxr-jpg", list: yield* cohort("subject_id\n1\n") }),
        ).toContain("no dicom_id or image_path column");
        expect(
          yield* refusal({ dataset: "mimic-cxr-jpg", list: yield* cohort("dicom_id\n") }),
        ).toContain("lists no images");
        const tooMany = `dicom_id\n${Array.from({ length: 1001 }, (_, i) => `d${i}`).join("\n")}\n`;
        expect(
          yield* refusal({ dataset: "mimic-cxr-jpg", list: yield* cohort(tooMany) }),
        ).toContain("at most 1000");
        expect(yield* refusal({ dataset: "nope", list: yield* cohort(COHORT) })).toContain(
          'no dataset called "nope"',
        );
      }),
    ),
  );

  it.effect("replaces a thread's waiting request for the same dataset, and declines", () =>
    withRequests(({ requests, cohort }) =>
      Effect.gen(function* () {
        const first = yield* requests.request({
          threadId: "thread-1",
          dataset: "mimic-cxr-jpg",
          list: yield* cohort(COHORT),
        });
        const second = yield* requests.request({
          threadId: "thread-1",
          dataset: "mimic-cxr-jpg",
          list: yield* cohort("dicom_id\nd9\n"),
        });
        expect((yield* requests.forThread("thread-1")).map((r) => r.id)).toEqual([second.id]);
        expect(Option.isNone(yield* requests.get(first.id))).toBe(true);

        const declined = yield* requests.decline(second.id);
        expect(declined.state).toBe("declined");
        // A declined request takes no login.
        const answer = yield* requests.answer(second.id, LOGIN).pipe(Effect.flip);
        expect(answer.message).toContain("closed");
      }),
    ),
  );

  it.effect("fetches for one request of a dataset at a time", () =>
    withRequests(({ requests, nextFetch, cohort }) =>
      Effect.gen(function* () {
        const first = yield* requests.request({
          threadId: "thread-1",
          dataset: "mimic-cxr-jpg",
          list: yield* cohort(COHORT),
        });
        const second = yield* requests.request({
          threadId: "thread-2",
          dataset: "mimic-cxr-jpg",
          list: yield* cohort(COHORT),
        });
        yield* requests.answer(first.id, LOGIN);
        yield* nextFetch;
        const refused = yield* requests.answer(second.id, LOGIN).pipe(Effect.flip);
        expect(refused.message).toContain("being fetched for another request");
        expect(Option.getOrThrow(yield* requests.get(second.id)).state).toBe("waiting-for-login");
      }),
    ),
  );

  it.effect("fetches the cohort it was asked about, though the agent's file changes", () =>
    withRequests(({ requests, nextFetch, cohort }) =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const list = yield* cohort(COHORT);
        const { id } = yield* requests.request({
          threadId: "thread-1",
          dataset: "mimic-cxr-jpg",
          list,
        });
        const rewritten = `dicom_id\n${Array.from({ length: 5000 }, (_, i) => `d${i}`).join("\n")}\n`;
        yield* fileSystem.writeFileString(list, rewritten).pipe(Effect.orDie);

        yield* requests.answer(id, LOGIN);
        const fetch = yield* nextFetch;
        expect(fetch.list).not.toBe(list);
        expect(yield* fileSystem.readFileString(fetch.list)).toBe(COHORT);
        expect(Option.getOrThrow(yield* requests.get(id)).images).toBe(3);
      }),
    ),
  );

  it.effect("shows a request only once M4 has said which images are missing", () =>
    withRequests(({ requests, cohort, holdChecks, nextCheck }) =>
      Effect.gen(function* () {
        holdChecks();
        const filing = yield* Effect.forkChild(
          requests.request({
            threadId: "thread-1",
            dataset: "mimic-cxr-jpg",
            list: yield* cohort(COHORT),
          }),
        );
        const check = yield* nextCheck;
        // Nothing to sign in to while M4 reads the disk.
        expect(yield* requests.forThread("thread-1")).toEqual([]);
        yield* Deferred.succeed(check, undefined);
        const request = yield* Fiber.join(filing);
        expect(request.state).toBe("waiting-for-login");
        expect(yield* requests.forThread("thread-1")).toEqual([request]);
      }),
    ),
  );

  it.effect("stops a fetch when the researcher says so", () =>
    withRequests(({ requests, nextFetch, cohort, stopCount }) =>
      Effect.gen(function* () {
        const { id } = yield* requests.request({
          threadId: "thread-1",
          dataset: "mimic-cxr-jpg",
          list: yield* cohort(COHORT),
        });
        yield* requests.answer(id, LOGIN);
        yield* nextFetch;

        const stopped = yield* requests.decline(id);
        expect(stopped).toMatchObject({ state: "declined" });
        expect(stopped.message).toContain("stopped fetching");
        expect(stopCount()).toBe(1);
        // A stopped request takes no login, and another one may fetch now.
        expect((yield* requests.answer(id, LOGIN).pipe(Effect.flip)).message).toContain("closed");
      }),
    ),
  );
});
