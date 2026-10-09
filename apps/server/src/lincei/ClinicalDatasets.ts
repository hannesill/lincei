/**
 * ClinicalDatasets - the clinical datasets on this machine, and adding more.
 *
 * M4 owns the datasets: which ones exist, where their files live, and how raw
 * files become a queryable database. This service runs M4's own commands so a
 * client can list them and add one without a terminal, and turns the progress
 * events M4 prints while it works into a job the client can show.
 *
 * Jobs live in memory. One that a server restart cuts short leaves its
 * finished files behind, and M4 resumes from them when it is started again.
 *
 * @module ClinicalDatasets
 */
import type {
  ClinicalDataset,
  ClinicalDatasetJob,
  ClinicalRuntimeStatus,
} from "@t3tools/contracts";
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import * as ProcessRunner from "../processRunner.ts";
import * as ClinicalRuntime from "./ClinicalRuntime.ts";

/** Dataset names go on M4's command line, so nothing that could read as an option. */
const DATASET_NAME = /^[a-z0-9][a-z0-9._-]*$/i;
/** A full MIMIC-IV download and conversion on a slow link. */
const JOB_TIMEOUT = "48 hours";
const OUTPUT_TAIL_CHARACTERS = 800;

const M4Failure = Schema.Struct({
  code: Schema.String,
  message: Schema.String,
  hint: Schema.optional(Schema.NullOr(Schema.String)),
});
type M4Failure = typeof M4Failure.Type;

/** The fields Lincei reads from `m4 list-datasets --json`. */
const M4DatasetList = Schema.Struct({
  ok: Schema.Boolean,
  data: Schema.optional(
    Schema.Struct({
      datasets: Schema.Array(
        Schema.Struct({
          name: Schema.String,
          setup_state: Schema.String,
          raw_present: Schema.Boolean,
          parquet_present: Schema.Boolean,
          requires_authentication: Schema.Boolean,
          download_available: Schema.Boolean,
          parquet_size_gb: Schema.optional(Schema.NullOr(Schema.Number)),
        }),
      ),
    }),
  ),
  error: Schema.optional(M4Failure),
});
const decodeM4DatasetList = Schema.decodeUnknownEffect(Schema.fromJsonString(M4DatasetList));

/** The fields Lincei reads from the progress events of `--events ndjson`. */
const M4Event = Schema.Struct({
  event: Schema.String,
  file_count: Schema.optional(Schema.NullOr(Schema.Number)),
  completed: Schema.optional(Schema.NullOr(Schema.Number)),
  path: Schema.optional(Schema.NullOr(Schema.String)),
  bytes_downloaded: Schema.optional(Schema.NullOr(Schema.Number)),
  bytes_total: Schema.optional(Schema.NullOr(Schema.Number)),
  error: Schema.optional(M4Failure),
});
type M4Event = typeof M4Event.Type;
const decodeM4Event = Schema.decodeUnknownOption(Schema.fromJsonString(M4Event));

export class ClinicalDatasetsError extends Schema.TaggedError<ClinicalDatasetsError>()(
  "ClinicalDatasetsError",
  {
    message: Schema.String,
    detail: Schema.optional(Schema.String),
  },
) {}

export class ClinicalDatasets extends Context.Service<
  ClinicalDatasets,
  {
    /** M4's datasets with what this machine holds of each and any job on it. */
    readonly list: Effect.Effect<ReadonlyArray<ClinicalDataset>, ClinicalDatasetsError>;
    /**
     * Starts preparing a dataset from raw files already in `source`. Like
     * `download`, returns the job's fiber once it has started; the job belongs
     * to the server, not the caller, and reports how it ended through `list`.
     */
    readonly add: (input: {
      readonly name: string;
      readonly source: string;
    }) => Effect.Effect<Fiber.Fiber<void>, ClinicalDatasetsError>;
    /** Starts downloading a dataset and preparing it. */
    readonly download: (input: {
      readonly name: string;
    }) => Effect.Effect<Fiber.Fiber<void>, ClinicalDatasetsError>;
    /** Stops a dataset's running job, or clears its failed one. */
    readonly cancel: (name: string) => Effect.Effect<void>;
  }
>()("t3/lincei/ClinicalDatasets") {}

const PHASE_MESSAGES: Record<ClinicalDatasetJob["phase"], string> = {
  starting: "Starting.",
  downloading: "Downloading the raw files.",
  converting: "Converting the files for fast queries.",
  indexing: "Building the database.",
};

const enterPhase = (
  job: ClinicalDatasetJob,
  phase: ClinicalDatasetJob["phase"],
  total: number | null | undefined,
): ClinicalDatasetJob => ({
  kind: job.kind,
  state: job.state,
  phase,
  completed: 0,
  ...(typeof total === "number" ? { total } : {}),
  message: PHASE_MESSAGES[phase],
});

const baseName = (filePath: string) => filePath.replace(/^.*[\\/]/, "");

/** The job after one of M4's progress events. Events it does not know change nothing. */
export const advanceJob = (job: ClinicalDatasetJob, event: M4Event): ClinicalDatasetJob => {
  const { file: _file, ...withoutFile } = job;
  switch (event.event) {
    case "download_listing_started":
      return job.phase === "downloading" ? job : enterPhase(job, "downloading", undefined);
    case "download_started":
      return enterPhase(job, "downloading", event.file_count);
    case "download_file_started":
    case "download_file_progress":
      return typeof event.path !== "string"
        ? job
        : {
            ...job,
            file: {
              name: baseName(event.path),
              bytes: event.bytes_downloaded ?? 0,
              ...(typeof event.bytes_total === "number" ? { totalBytes: event.bytes_total } : {}),
            },
          };
    case "download_file_completed":
    case "download_file_skipped":
      return { ...withoutFile, completed: job.completed + 1 };
    case "conversion_started":
      return enterPhase(job, "converting", event.file_count);
    case "duckdb_init_started":
      return enterPhase(job, "indexing", event.file_count);
    case "conversion_file_completed":
    case "duckdb_view_created":
      return { ...job, completed: event.completed ?? job.completed + 1 };
    default:
      return job;
  }
};

/** Why a job stopped, in words for the person who started it. */
const describeFailure = (name: string, failure: M4Failure | undefined): string => {
  switch (failure?.code) {
    case "physionet_auth_failed":
      return "PhysioNet did not accept that username and password.";
    case "physionet_access_forbidden":
      return `This PhysioNet account does not have access to ${name} yet. Sign the dataset's data use agreement on PhysioNet, then try again.`;
    case "missing_credentials":
      return `Downloading ${name} needs a PhysioNet account with access to it.`;
    case "download_network_failed":
      return "The download was interrupted. Check the connection and try again; files already downloaded are kept.";
    case "raw_files_missing":
      return `No raw files for ${name} were found there. Choose the folder that holds its CSV.gz files.`;
    case "dataset_not_found":
      return `M4 does not know a dataset called ${name}.`;
    default:
      return failure?.message ?? `Preparing ${name} did not finish.`;
  }
};

/** Calls `onLine` for each complete line of a stream that arrives in arbitrary chunks. */
const lineReader = (onLine: (line: string) => void) => {
  const decoder = new TextDecoder();
  let pending = "";
  return (chunk: Uint8Array) => {
    const lines = (pending + decoder.decode(chunk, { stream: true })).split("\n");
    pending = lines.pop() ?? "";
    for (const line of lines) {
      if (line.trim().length > 0) onLine(line);
    }
  };
};

/** Whether M4 is installed: the demo dataset downloads last and is not needed to run it. */
export const m4Installed = (status: ClinicalRuntimeStatus) =>
  status.state === "ready" || (status.state === "installing" && status.step === "dataset");

const make = Effect.gen(function* () {
  const clinicalRuntime = yield* ClinicalRuntime.ClinicalRuntime;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const platform = yield* HostProcessPlatform;
  const processRunner = yield* ProcessRunner.ProcessRunner;
  const scope = yield* Effect.scope;

  // M4's progress arrives through a synchronous stdout callback, so job state
  // is plain mutable state read by `list` rather than a Ref.
  const jobs = new Map<string, ClinicalDatasetJob>();
  const fibers = new Map<string, Fiber.Fiber<void>>();
  let listing: ReadonlyArray<ClinicalDataset> | undefined;

  const m4 = Effect.gen(function* () {
    const status = yield* clinicalRuntime.status;
    if (!m4Installed(status)) {
      return yield* new ClinicalDatasetsError({
        message: "The clinical environment is not set up yet.",
        detail: status.message,
      });
    }
    return {
      command: path.join(path.dirname(status.python), platform === "win32" ? "m4.exe" : "m4"),
      env: { M4_DATA_DIR: status.dataDir },
    };
  });

  const readListing = Effect.gen(function* () {
    const { command, env } = yield* m4;
    const output = yield* processRunner
      .run({
        command,
        args: ["list-datasets", "--json"],
        env,
        timeout: "60 seconds",
        outputMode: "truncate",
        maxOutputBytes: 256 * 1024,
      })
      .pipe(
        Effect.mapError(
          () => new ClinicalDatasetsError({ message: "Could not ask M4 for its datasets." }),
        ),
      );
    const report = yield* decodeM4DatasetList(output.stdout.trim()).pipe(
      Effect.mapError(
        () =>
          new ClinicalDatasetsError({
            message: "M4 did not report its datasets.",
            detail: (output.stderr.trim() || output.stdout.trim()).slice(-OUTPUT_TAIL_CHARACTERS),
          }),
      ),
    );
    if (report.data === undefined) {
      return yield* new ClinicalDatasetsError({
        message: report.error?.message ?? "M4 could not list its datasets.",
      });
    }
    return report.data.datasets.map(
      (dataset): ClinicalDataset => ({
        name: dataset.name,
        state:
          dataset.setup_state === "ready"
            ? "ready"
            : dataset.raw_present || dataset.parquet_present
              ? "incomplete"
              : "missing",
        requiresCredentials: dataset.requires_authentication,
        downloadable: dataset.download_available,
        ...(typeof dataset.parquet_size_gb === "number" && dataset.parquet_size_gb > 0
          ? { sizeGb: dataset.parquet_size_gb }
          : {}),
      }),
    );
  });

  const list = Effect.gen(function* () {
    // A running job changes nothing M4 reports until it ends, and clients ask
    // every few seconds while one runs, so M4 is only asked in between.
    const running = [...jobs.values()].some((job) => job.state === "running");
    if (listing === undefined || !running) listing = yield* readListing;
    return listing.map((dataset) => {
      const job = jobs.get(dataset.name);
      return job === undefined ? dataset : { ...dataset, job };
    });
  });

  /** Runs one M4 command to its end, feeding its progress events into the dataset's job. */
  const runM4 = Effect.fn("ClinicalDatasets.runM4")(function* (
    name: string,
    args: ReadonlyArray<string>,
  ) {
    const { command, env } = yield* m4;
    let failure: M4Failure | undefined;
    const output = yield* processRunner
      .run({
        command,
        args: [...args, "--json", "--events", "ndjson"],
        env,
        timeout: JOB_TIMEOUT,
        outputMode: "truncate",
        maxOutputBytes: 64 * 1024,
        onStdoutChunk: lineReader((line) => {
          const event = decodeM4Event(line);
          if (Option.isNone(event)) return;
          if (event.value.event === "operation_failed") failure = event.value.error;
          const job = jobs.get(name);
          if (job !== undefined) jobs.set(name, advanceJob(job, event.value));
        }),
      })
      .pipe(
        Effect.mapError(
          () => new ClinicalDatasetsError({ message: `Could not run M4 to prepare ${name}.` }),
        ),
      );
    if (failure === undefined && output.code !== null && Number(output.code) === 0) return;
    const detail = [failure?.message, failure?.hint ?? undefined]
      .filter((part) => part !== undefined)
      .join(" ");
    return yield* new ClinicalDatasetsError({
      message: describeFailure(name, failure),
      detail: detail || output.stderr.trim().slice(-OUTPUT_TAIL_CHARACTERS) || undefined,
    });
  });

  /** Runs `work` as the dataset's job in the server's scope and returns its fiber. */
  const start = Effect.fn("ClinicalDatasets.start")(function* (
    name: string,
    kind: ClinicalDatasetJob["kind"],
    work: Effect.Effect<void, ClinicalDatasetsError>,
  ) {
    if (!DATASET_NAME.test(name)) {
      return yield* new ClinicalDatasetsError({ message: `"${name}" is not a dataset name.` });
    }
    // Fail before there is a job, so the caller hears that nothing started.
    yield* m4;
    if (jobs.get(name)?.state === "running") {
      return yield* new ClinicalDatasetsError({ message: `${name} is already being prepared.` });
    }
    const running: ClinicalDatasetJob = {
      kind,
      state: "running",
      phase: "starting",
      completed: 0,
      message: PHASE_MESSAGES.starting,
    };
    jobs.set(name, running);
    let self: Fiber.Fiber<void> | undefined;
    const fiber = yield* work.pipe(
      Effect.matchCauseEffect({
        onSuccess: () =>
          Effect.sync(() => {
            jobs.delete(name);
            listing = undefined;
          }),
        onFailure: (cause) => {
          // `cancel` already removed the job it interrupted.
          if (Cause.hasInterruptsOnly(cause)) return Effect.void;
          const error = Cause.findErrorOption(cause);
          return Effect.logWarning("clinical dataset job failed", { dataset: name, cause }).pipe(
            Effect.andThen(
              Effect.sync(() => {
                listing = undefined;
                jobs.set(name, {
                  ...(jobs.get(name) ?? running),
                  state: "failed",
                  message: Option.match(error, {
                    onNone: () => `Preparing ${name} stopped unexpectedly.`,
                    onSome: (failure) => failure.message,
                  }),
                  ...Option.match(error, {
                    onNone: () => ({}),
                    onSome: (failure) =>
                      failure.detail === undefined ? {} : { detail: failure.detail },
                  }),
                });
              }),
            ),
          );
        },
      }),
      // A job cancelled and started again must not drop its successor's fiber.
      Effect.ensuring(
        Effect.sync(() => {
          if (fibers.get(name) === self) fibers.delete(name);
        }),
      ),
      Effect.forkIn(scope),
    );
    self = fiber;
    fibers.set(name, fiber);
    return fiber;
  });

  const add: ClinicalDatasets["Service"]["add"] = ({ name, source }) =>
    Effect.gen(function* () {
      const isDirectory =
        path.isAbsolute(source) &&
        (yield* fileSystem.stat(source).pipe(
          Effect.map((info) => info.type === "Directory"),
          Effect.orElseSucceed(() => false),
        ));
      if (!isDirectory) {
        return yield* new ClinicalDatasetsError({
          message: "That folder does not exist on the computer Lincei runs on.",
          detail: source,
        });
      }
      return yield* start(
        name,
        "add",
        runM4(name, ["init", name, "--src", source, "--no-interactive"]),
      );
    });

  const download: ClinicalDatasets["Service"]["download"] = ({ name }) =>
    start(
      name,
      "download",
      runM4(name, ["download", name]).pipe(
        Effect.andThen(runM4(name, ["init", name, "--no-interactive"])),
      ),
    );

  const cancel: ClinicalDatasets["Service"]["cancel"] = (name) =>
    Effect.gen(function* () {
      const fiber = fibers.get(name);
      jobs.delete(name);
      listing = undefined;
      if (fiber !== undefined) yield* Fiber.interrupt(fiber);
    });

  return ClinicalDatasets.of({ list, add, download, cancel });
});

export const layer = Layer.effect(ClinicalDatasets, make);
