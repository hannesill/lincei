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
 * A PhysioNet login is held for the one download it was given for and goes
 * to M4 through its standard input: never a command line, the environment, a
 * file, or a log. Nothing keeps it afterwards, so the next download asks again.
 *
 * @module ClinicalDatasets
 */
import type {
  ClinicalDataset,
  ClinicalDatasetJob,
  ClinicalRuntimeStatus,
  PhysioNetCredentials,
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
import * as Redacted from "effect/Redacted";
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

/** The document M4 reads a PhysioNet login from. */
const encodeM4Credentials = Schema.encodeSync(
  Schema.fromJsonString(Schema.Struct({ username: Schema.String, password: Schema.String })),
);

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
    /** Starts downloading a dataset and preparing it. Credentialed datasets need the login. */
    readonly download: (input: {
      readonly name: string;
      readonly credentials?: PhysioNetCredentials | undefined;
    }) => Effect.Effect<Fiber.Fiber<void>, ClinicalDatasetsError>;
    /** Stops a dataset's running job, or clears its failed one. */
    readonly cancel: (name: string) => Effect.Effect<void>;
  }
>()("t3/lincei/ClinicalDatasets") {}

const SETUP_JOB: ClinicalDatasetJob = {
  kind: "setup",
  state: "running",
  phase: "starting",
  completed: 0,
  message: "Downloading as part of clinical setup.",
};

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
    // PhysioNet answers a wrong password and a missing agreement the same way.
    case "physionet_auth_failed":
    case "physionet_access_forbidden":
      return `PhysioNet refused this login for ${name}. Check the username and password, and that the account has signed the dataset's data use agreement on physionet.org.`;
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
  /** Whether work was running when `listing` was read: its end makes the listing stale. */
  let listedWhileRunning = false;

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

  /** Setup downloads the demo dataset itself, outside the jobs here. */
  const setupIsDownloadingDemo = Effect.map(
    clinicalRuntime.status,
    (status) => status.state === "installing" && status.step === "dataset",
  );

  const list = Effect.gen(function* () {
    // Running work changes nothing M4 reports until it ends, and clients ask
    // every few seconds while it runs, so M4 is only asked in between.
    const settingUp = yield* setupIsDownloadingDemo;
    const running = settingUp || [...jobs.values()].some((job) => job.state === "running");
    if (listing === undefined || !running || listedWhileRunning !== running) {
      listing = yield* readListing;
    }
    listedWhileRunning = running;
    return listing.map((dataset) => {
      const job =
        jobs.get(dataset.name) ??
        (settingUp && dataset.name === ClinicalRuntime.DEMO_DATASET && dataset.state !== "ready"
          ? SETUP_JOB
          : undefined);
      return job === undefined ? dataset : { ...dataset, job };
    });
  });

  /** Runs one M4 command to its end, feeding its progress events into the dataset's job. */
  const runM4 = Effect.fn("ClinicalDatasets.runM4")(function* (
    name: string,
    args: ReadonlyArray<string>,
    credentials?: PhysioNetCredentials,
  ) {
    const { command, env } = yield* m4;
    let failure: M4Failure | undefined;
    const password = credentials === undefined ? undefined : Redacted.value(credentials.password);
    // M4 redacts the password from what it reports. This is for whatever else
    // ends up on its error stream, since the end of that is shown to the user.
    const withoutPassword = (text: string) =>
      password === undefined || password.length === 0
        ? text
        : text.replaceAll(password, "<redacted>");
    const output = yield* processRunner
      .run({
        command,
        args: [
          ...args,
          // M4 reads the login as a JSON document from a path. Its standard
          // input is the one path that is never a file on disk.
          ...(credentials === undefined ? [] : ["--physionet-credentials-file", "/dev/stdin"]),
          "--json",
          "--events",
          "ndjson",
        ],
        env,
        ...(credentials === undefined || password === undefined
          ? {}
          : { stdin: encodeM4Credentials({ username: credentials.username, password }) }),
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
      detail:
        withoutPassword(detail || output.stderr.trim().slice(-OUTPUT_TAIL_CHARACTERS)) || undefined,
    });
  });

  const requireDatasetName = (name: string) =>
    DATASET_NAME.test(name)
      ? Effect.void
      : Effect.fail(new ClinicalDatasetsError({ message: `"${name}" is not a dataset name.` }));

  /** Runs `work` as the dataset's job in the server's scope and returns its fiber. */
  const start = Effect.fn("ClinicalDatasets.start")(function* (
    name: string,
    kind: "add" | "download",
    work: Effect.Effect<void, ClinicalDatasetsError>,
  ) {
    yield* requireDatasetName(name);
    // Fail before there is a job, so the caller hears that nothing started.
    yield* m4;
    if (
      jobs.get(name)?.state === "running" ||
      (name === ClinicalRuntime.DEMO_DATASET && (yield* setupIsDownloadingDemo))
    ) {
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

  const download: ClinicalDatasets["Service"]["download"] = ({ name, credentials }) =>
    Effect.gen(function* () {
      yield* requireDatasetName(name);
      // An open dataset is downloaded without a login even when one was sent.
      const dataset = (yield* list).find((candidate) => candidate.name === name);
      const login = dataset?.requiresCredentials === true ? credentials : undefined;
      if (dataset?.requiresCredentials === true && login === undefined) {
        return yield* new ClinicalDatasetsError({
          message: `Downloading ${name} needs a PhysioNet account with access to it.`,
        });
      }
      if (login !== undefined && platform === "win32") {
        return yield* new ClinicalDatasetsError({
          message:
            "Lincei cannot download credentialed datasets on Windows yet. Download the files from PhysioNet and add the folder instead.",
        });
      }
      return yield* start(
        name,
        "download",
        runM4(name, ["download", name], login).pipe(
          // Preparing the downloaded files needs no login.
          Effect.andThen(runM4(name, ["init", name, "--no-interactive"])),
        ),
      );
    });

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
