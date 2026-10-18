/**
 * ClinicalDatasets - the clinical datasets on this machine, and adding more.
 *
 * M4 owns the datasets: which ones exist, where their files live, and how raw
 * files become a queryable database. This service runs M4's own commands so a
 * client can list them and add one without a terminal, and turns the progress
 * events M4 prints while it works into a job the client can show. Clinical
 * setup downloads the demo dataset through it too, so every run of M4 that
 * writes a dataset goes through one place and no dataset has two at once.
 *
 * Jobs live in memory. What a job left unfinished does not. M4 calls a dataset
 * ready as soon as some converted files and a database exist, and converts
 * nothing once any converted file exists, so a preparation that was cancelled,
 * killed, or failed would come back as a ready dataset with tables missing.
 * Before M4 prepares a dataset this service therefore writes a mark under the
 * clinical home, and removes it only when M4 reports the preparation complete.
 * A marked dataset is never reported ready, and the next attempt first removes
 * the converted files and the database M4 reports for it, so M4 converts
 * everything again. Only what M4 made, inside Lincei's own dataset store, is
 * removed: never raw files, never the folder the user pointed at, and nothing
 * at all in a store the user chose themselves with `M4_DATA_DIR`.
 *
 * A PhysioNet login is held for the one download it was given for and goes
 * to M4 through its standard input: never a command line, the environment, a
 * file, or a log. Nothing keeps it afterwards, so the next download asks again.
 * It is sent only when M4 would download from physionet.org.
 *
 * Fetching a cohort's images from an imaging dataset (`fetchImages`) runs M4
 * the same way, with the same handling of a login, but is not a job on the
 * dataset: it belongs to the agent's request that asked for it
 * (ClinicalImageRequests.ts), which shows its progress in that thread.
 *
 * @module ClinicalDatasets
 */
import type {
  ClinicalDataset,
  ClinicalDatasetActions,
  ClinicalDatasetJob,
  PhysioNetCredentials,
} from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";

import * as ServerConfig from "../config.ts";
import * as ProcessRunner from "../processRunner.ts";
import { clinicalPaths } from "./clinicalPaths.ts";

/** The open dataset clinical setup downloads, so there is something to query on first run. */
const DEMO_DATASET = "mimic-iv-demo";
/** Dataset names go on M4's command line and name a file, so nothing that reads as an option or a path. */
const DATASET_NAME = /^[a-z0-9][a-z0-9._-]*$/;
/** A full MIMIC-IV download and conversion on a slow link. */
const JOB_TIMEOUT = "48 hours";
const OUTPUT_TAIL_CHARACTERS = 800;
/** The only host a PhysioNet login is sent to. */
const PHYSIONET_HOST = "physionet.org";
/** M4 reads the login from its standard input itself, on every platform, from the release that has this. */
const LOGIN_ON_STDIN = "--physionet-credentials-stdin";
/**
 * The one finding of M4's check of a raw folder that it passes although the
 * dataset would come out with no tables: files that belong at the top of the
 * folder lie deeper in it. M4 0.5.8 checks this for every dataset with files
 * at the top, under a new name; before that it checked eICU alone.
 */
const FILES_TOO_DEEP: ReadonlySet<string> = new Set([
  "wrong_root_layout",
  "wrong_eicu_root_layout",
]);
const MARK_NOTE =
  "Lincei started preparing this dataset, and M4 has not reported the preparation complete.\n" +
  "Until it does, Lincei shows the dataset as incomplete and converts it again on the next attempt.\n";

const M4Failure = Schema.Struct({
  code: Schema.String,
  message: Schema.String,
  hint: Schema.optional(Schema.NullOr(Schema.String)),
});
type M4Failure = typeof M4Failure.Type;

/** The fields Lincei reads about one dataset from `m4 list-datasets --json --paths`. */
const M4Dataset = Schema.Struct({
  name: Schema.String,
  setup_state: Schema.String,
  raw_present: Schema.Boolean,
  parquet_present: Schema.Boolean,
  requires_authentication: Schema.Boolean,
  download_available: Schema.Boolean,
  parquet_size_gb: Schema.optional(Schema.NullOr(Schema.Number)),
  // Where M4 keeps the dataset's files. Read to remove what a run left
  // unfinished, and never sent to a client.
  raw_root: Schema.optional(Schema.NullOr(Schema.String)),
  parquet_root: Schema.optional(Schema.NullOr(Schema.String)),
  db_path: Schema.optional(Schema.NullOr(Schema.String)),
  // Reported by an M4 that records when a dataset's preparation finished and
  // completes an unfinished one itself (after 0.5.5). Absent before that.
  prepared: Schema.optional(Schema.Boolean),
  // What the dataset is, from its definition, reported from M4 0.5.8 on.
  title: Schema.optional(Schema.NullOr(Schema.String)),
  summary: Schema.optional(Schema.NullOr(Schema.String)),
  version: Schema.optional(Schema.NullOr(Schema.String)),
  download_size_gb: Schema.optional(Schema.NullOr(Schema.Number)),
  builtin: Schema.optional(Schema.Boolean),
  // Where the dataset's data use agreement is signed, and its page, from M4
  // releases after 0.5.7. PhysioNet has the agreement on the dataset's page.
  dua_url: Schema.optional(Schema.NullOr(Schema.String)),
  dataset_page_url: Schema.optional(Schema.NullOr(Schema.String)),
});
type M4Dataset = typeof M4Dataset.Type;

const M4DatasetList = Schema.Struct({
  ok: Schema.Boolean,
  data: Schema.optional(Schema.Struct({ datasets: Schema.Array(M4Dataset) })),
  error: Schema.optional(M4Failure),
});
const decodeM4DatasetList = Schema.decodeUnknownEffect(Schema.fromJsonString(M4DatasetList));

/**
 * The fields Lincei reads from `m4 download <name> --command-only --json`,
 * which downloads nothing: where the dataset would come from, and what M4
 * makes of the raw folder named with `--target`.
 */
const M4DownloadPlan = Schema.Struct({
  file_listing_url: Schema.optional(Schema.NullOr(Schema.String)),
  /** The agreement's page, else the dataset's page, else `file_listing_url`. */
  access_url: Schema.optional(Schema.NullOr(Schema.String)),
  layout: Schema.optional(
    Schema.Struct({
      ok: Schema.Boolean,
      warnings: Schema.optional(Schema.Array(Schema.String)),
      errors: Schema.optional(Schema.Array(Schema.String)),
      csv_gz_count: Schema.optional(Schema.NullOr(Schema.Number)),
      empty_csv_gz: Schema.optional(Schema.Array(Schema.String)),
    }),
  ),
  error: Schema.optional(M4Failure),
});
const decodeM4DownloadPlan = Schema.decodeUnknownOption(Schema.fromJsonString(M4DownloadPlan));

/**
 * What Lincei reads from `m4 define-dataset --json` and `m4 remove-dataset
 * --json`: whether M4 did it, and why not.
 */
const M4Outcome = Schema.Struct({
  ok: Schema.Boolean,
  error: Schema.optional(M4Failure),
});
const decodeM4Outcome = Schema.decodeUnknownOption(Schema.fromJsonString(M4Outcome));

/** The fields Lincei reads from `m4 capabilities --json`. */
const M4Capabilities = Schema.Struct({
  commands: Schema.Array(
    Schema.Struct({ name: Schema.String, flags: Schema.optional(Schema.Array(Schema.String)) }),
  ),
});
const decodeM4Capabilities = Schema.decodeUnknownOption(Schema.fromJsonString(M4Capabilities));

/** The fields Lincei reads from the progress events of `--events ndjson`. */
const M4Event = Schema.Struct({
  event: Schema.String,
  file_count: Schema.optional(Schema.NullOr(Schema.Number)),
  completed: Schema.optional(Schema.NullOr(Schema.Number)),
  path: Schema.optional(Schema.NullOr(Schema.String)),
  bytes_downloaded: Schema.optional(Schema.NullOr(Schema.Number)),
  bytes_total: Schema.optional(Schema.NullOr(Schema.Number)),
  error: Schema.optional(M4Failure),
  // A `conversion_warning`: how a file was read when it was not as expected.
  code: Schema.optional(Schema.String),
  file: Schema.optional(Schema.String),
  columns: Schema.optional(Schema.Array(Schema.String)),
});
type M4Event = typeof M4Event.Type;
const decodeM4Event = Schema.decodeUnknownOption(Schema.fromJsonString(M4Event));

/** Whether a login may go to this address, or a researcher be sent to it to sign in. */
const isPhysioNet = (url: URL) =>
  url.protocol === "https:" &&
  url.hostname === PHYSIONET_HOST &&
  url.username === "" &&
  url.password === "";

/**
 * A page M4 names, if it is on physionet.org. A file in M4's dataset store
 * can define a dataset, its pages included, and agents can write there.
 */
const physioNetPage = (address: string | null | undefined) => {
  const url = typeof address !== "string" || !URL.canParse(address) ? undefined : new URL(address);
  return url !== undefined && isPhysioNet(url) ? url.href : undefined;
};

/**
 * JSON with every character outside ASCII written as an escape. M4 decodes
 * its standard input with the system's code page, which on Windows is not
 * UTF-8, and ASCII reads the same in all of them.
 */
const asciiJson = (json: string) =>
  json.replace(/[\u007f-￿]/g, (unit) => `\\u${unit.charCodeAt(0).toString(16).padStart(4, "0")}`);

/** The document M4 reads a PhysioNet login from. */
const encodeM4Credentials = (credentials: {
  readonly username: string;
  readonly password: string;
}) =>
  asciiJson(
    Schema.encodeSync(
      Schema.fromJsonString(Schema.Struct({ username: Schema.String, password: Schema.String })),
    )(credentials),
  );

export class ClinicalDatasetsError extends Schema.TaggedError<ClinicalDatasetsError>()(
  "ClinicalDatasetsError",
  {
    /** What went wrong and what to do next, in words for the person who asked. */
    message: Schema.String,
    /** What M4 reported, for whoever helps them. */
    detail: Schema.optional(Schema.String),
    /** M4's code for why it stopped, when it said. */
    code: Schema.optional(Schema.String),
    cause: Schema.optional(Schema.Defect()),
  },
) {}

export class ClinicalDatasets extends Context.Service<
  ClinicalDatasets,
  {
    /** M4's datasets with what this machine holds of each and any job on it. */
    readonly list: Effect.Effect<ReadonlyArray<ClinicalDataset>, ClinicalDatasetsError>;
    /** What the installed M4 can do beyond listing, adding and downloading. */
    readonly actions: Effect.Effect<ClinicalDatasetActions>;
    /**
     * Starts preparing a dataset from raw files already in `source`. Like
     * `download`, returns the job's fiber once it has started; the job belongs
     * to the server, not the caller, and reports how it ended through `list`.
     * The fiber ends with whether the dataset was prepared.
     */
    readonly add: (input: {
      readonly name: string;
      readonly source: string;
    }) => Effect.Effect<Fiber.Fiber<boolean>, ClinicalDatasetsError>;
    /** Starts downloading a dataset and preparing it. Credentialed datasets need the login. */
    readonly download: (input: {
      readonly name: string;
      readonly credentials?: PhysioNetCredentials | undefined;
    }) => Effect.Effect<Fiber.Fiber<boolean>, ClinicalDatasetsError>;
    /**
     * Defines a dataset of the user's own from the raw files in `source`, as
     * M4 reads the folder, then starts preparing it like `add`. A folder M4
     * cannot make tables of is refused before anything starts.
     */
    readonly define: (input: {
      readonly name: string;
      readonly title: string;
      readonly source: string;
    }) => Effect.Effect<Fiber.Fiber<boolean>, ClinicalDatasetsError>;
    /** Stops a dataset's running job, or clears its failed one. Setup's own job is left running. */
    readonly cancel: (name: string) => Effect.Effect<void>;
    /**
     * Opens a folder in the file manager of this machine: the one that holds
     * the prepared datasets, or with `name` that dataset's prepared files.
     */
    readonly openFolder: (name?: string) => Effect.Effect<void, ClinicalDatasetsError>;
    /**
     * Deletes what M4 prepared of a dataset inside its dataset store, and the
     * definition of one defined on this computer, with M4's own command.
     * Raw files the user pointed at are never touched.
     */
    readonly remove: (name: string) => Effect.Effect<void, ClinicalDatasetsError>;
    /**
     * Downloads and prepares the demo dataset for clinical setup and waits for
     * it, joining a job that is already running on it. True when it ended
     * prepared; a failure stays on the dataset as its failed job.
     */
    readonly prepareDemo: Effect.Effect<boolean>;
    /** Whether the demo dataset was ready the last time this server looked or prepared it. */
    readonly demoReady: Effect.Effect<boolean>;
    /**
     * Fetches the images a cohort lists from an imaging dataset, with
     * `m4 fetch-images`. `list` is a CSV file on this machine naming the
     * images. Runs to its end in the caller's fiber, reporting progress to
     * `onProgress`. Without a login, M4 fetches from a credentialed dataset
     * only when every image is already here, and otherwise fails with the
     * code `missing_credentials`, having fetched nothing.
     */
    readonly fetchImages: (input: {
      readonly name: string;
      readonly list: string;
      readonly credentials?: PhysioNetCredentials | undefined;
      readonly onProgress?: ((progress: ClinicalDatasetJob) => void) | undefined;
    }) => Effect.Effect<void, ClinicalDatasetsError>;
  }
>()("t3/lincei/ClinicalDatasets") {}

type JobKind = ClinicalDatasetJob["kind"];
/** What M4 was doing when it stopped: a dataset's job, or fetching images for an agent. */
type WorkKind = JobKind | "fetch";

/** A PhysioNet login for one run of M4, with the arguments that make M4 read it from standard input. */
interface Login {
  readonly credentials: PhysioNetCredentials;
  readonly arguments: ReadonlyArray<string>;
  /** Where the account signs the dataset's data use agreement, for when PhysioNet refuses it. */
  readonly agreementUrl: string | undefined;
}

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

/**
 * What a dataset is, as M4's definition of it says. A definition can be a
 * file that agents write, and a client shows the page as a link to follow,
 * so only an https address is passed on.
 */
const aboutDataset = (dataset: M4Dataset): Partial<ClinicalDataset> => {
  const text = (value: string | null | undefined) => value?.trim() || undefined;
  const title = text(dataset.title);
  const summary = text(dataset.summary);
  const version = text(dataset.version);
  const page = text(dataset.dataset_page_url);
  const pageUrl = page !== undefined && URL.canParse(page) ? new URL(page) : undefined;
  const size = dataset.download_size_gb;
  return {
    ...(title === undefined ? {} : { title }),
    ...(summary === undefined ? {} : { summary }),
    ...(version === undefined ? {} : { version }),
    ...(pageUrl?.protocol === "https:" && pageUrl.username === "" && pageUrl.password === ""
      ? { pageUrl: pageUrl.href }
      : {}),
    ...(typeof size === "number" && size > 0 ? { downloadSizeGb: size } : {}),
    ...(dataset.builtin === false ? { custom: true } : {}),
  };
};

/**
 * What a `conversion_warning` means for whoever uses the dataset, or nothing
 * for one that changes nothing they would notice.
 */
const describeConversionWarning = (event: M4Event): string | undefined => {
  const file = event.file === undefined ? "A file" : baseName(event.file);
  switch (event.code) {
    case "decimal_comma_columns_kept_as_text": {
      const columns = event.columns ?? [];
      return `${file}: ${columns.length === 1 ? "column" : "columns"} ${columns.join(", ")} ${columns.length === 1 ? "uses" : "use"} decimal commas, so ${columns.length === 1 ? "it was" : "they were"} kept as text. Agents convert ${columns.length === 1 ? "it" : "them"} where they need numbers.`;
    }
    case "csv_read_as_latin1":
      return `${file} is not saved as UTF-8 and was read as Latin-1. Check that its accented letters look right.`;
    default:
      return undefined;
  }
};

/** The job after one of M4's progress events. Events it does not know change nothing. */
const advanceJob = (job: ClinicalDatasetJob, event: M4Event): ClinicalDatasetJob => {
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

/** How to repeat a job that stopped: the client's button on the dataset's row, whichever way it was added. */
const RETRY = "Choose Try again on its row to retry.";

const NOT_INSTALLED =
  "The clinical research tools are not installed yet. Set them up under Settings, Clinical Data.";
/** Agents can reinstall the tools (`lincei_clinical_setup` with `force`), which is the repair there is. */
const ASK_FOR_REPAIR =
  "If it keeps failing, quit Lincei and open it again, or ask an agent in a conversation to repair the clinical research tools.";
const LIST_UNREADABLE = `Lincei could not read the list of datasets from M4. Try again. ${ASK_FOR_REPAIR}`;

const unknownDataset = (name: string) =>
  `Lincei does not know a dataset called "${name.slice(0, 60)}". Choose one from the list under Settings, Clinical Data.`;

const loginRequired = (name: string) =>
  `Downloading ${name} needs your PhysioNet login. Choose Add on its row and sign in.`;

const loginNotPossible = (name: string) =>
  `Lincei cannot download ${name} with a PhysioNet login on this computer yet. Download its files from physionet.org, then add it and choose their folder.`;

/** Why M4 stopped, in words for the person who started the job, with what to do next. */
const describeFailure = (
  name: string,
  kind: WorkKind,
  code: string | undefined,
  agreementUrl?: string,
): string => {
  // A fetch was asked for by an agent, and is repeated by asking it again.
  const again =
    kind === "fetch"
      ? "ask the agent in the conversation to fetch the images again"
      : "choose Try again on its row";
  switch (code) {
    // M4 0.5.5 sent the login in a way PhysioNet ignores, so there every
    // login ended in "forbidden". Since 0.5.6 a wrong password is its own case.
    case "physionet_auth_failed":
      return `PhysioNet did not accept this username and password. Check them by signing in on physionet.org, then ${again}.`;
    // An account that already reaches other credentialed datasets most often
    // lacks only this one's agreement, so that step comes first.
    case "physionet_access_forbidden":
      return agreementUrl === undefined
        ? `This PhysioNet account has no access to ${name} yet. It needs credentialing, the required training, and the data use agreement signed on the dataset's page on physionet.org. Then ${again}.`
        : `This PhysioNet account has no access to ${name} yet. Sign the data use agreement on ${agreementUrl}, then ${again}. If PhysioNet does not offer you the agreement there, the account first needs credentialing and the required training.`;
    case "missing_credentials":
      return kind === "fetch"
        ? `The PhysioNet login did not reach the fetch from ${name}. Sign in again when the agent asks.`
        : `The PhysioNet login did not reach the download of ${name}. Choose Try again on its row and sign in again.`;
    case "download_network_failed":
    case "download_interrupted":
      return `The download of ${name} stopped because the connection failed or PhysioNet did not answer. Check the internet connection, then ${again}; files already downloaded are kept.`;
    case "download_filesystem_failed":
      return `Lincei could not save the files of ${name}. Check that the disk has enough free space, then ${again}; files already downloaded are kept.`;
    case "raw_files_missing":
      return kind === "add"
        ? `No raw files for ${name} were found in that folder. Choose the folder that holds its CSV.gz files.`
        : `PhysioNet listed no files to download for ${name}. Try again later, or download the files from physionet.org and choose their folder instead.`;
    case "dataset_not_found":
      return unknownDataset(name);
    case "conversion_failed":
      return `Lincei could not convert the files of ${name}. A file may be damaged or incomplete, or the disk may be full. Check both. ${RETRY}`;
    case "duckdb_init_failed":
      return `Lincei could not build the database for ${name}. If an agent or another program is using this dataset, let it finish. ${RETRY}`;
    case "csv_encoding_unsupported":
      return `A file of ${name} is not saved as UTF-8 text, and Lincei could not read it any other way. Save it again as "CSV UTF-8" (in Excel: File, Save As), then ${kind === "add" ? "choose Try again on its row" : "try again"}.`;
    case "verification_failed":
      return `Lincei prepared ${name}, but its main table is missing or cannot be read, so it is not ready. Check that the raw files are complete. ${RETRY}`;
    default:
      return kind === "fetch"
        ? `Fetching images from ${name} did not finish. Ask the agent in the conversation to try again.`
        : `Preparing ${name} did not finish. ${RETRY}`;
  }
};

/** Why M4 could not be run to its end, in the same words. */
const describeRunFailure = (name: string, cause: ProcessRunner.ProcessRunError): string => {
  switch (cause._tag) {
    case "ProcessTimeoutError":
      return `Preparing ${name} took more than two days and was stopped. ${RETRY}`;
    case "ProcessSpawnError":
      return `Lincei could not start M4, which prepares datasets. ${RETRY} ${ASK_FOR_REPAIR}`;
    default:
      return `Lincei lost contact with M4 while it was preparing ${name}. ${RETRY}`;
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

/**
 * Hides a secret in text that is about to be shown or logged. M4 redacts the
 * password from what it reports; this is for whatever else ends up in its
 * output, such as a crash report.
 */
const hiding = (secret: string | undefined) => {
  // Also as it is written inside the JSON document M4 was sent, with and
  // without its escapes.
  const forms =
    secret === undefined || secret.length === 0
      ? []
      : [
          ...new Set([
            secret,
            JSON.stringify(secret).slice(1, -1),
            asciiJson(JSON.stringify(secret)).slice(1, -1),
          ]),
        ];
  const longest = Math.max(0, ...forms.map((form) => form.length));
  const hide = (text: string) =>
    forms.reduce((hidden, form) => hidden.replaceAll(form, "<redacted>"), text);
  return {
    hide,
    /**
     * The end of a command's output. The secret is hidden before the text is
     * cut, so no part of it survives at an edge; where the runner already cut
     * the output short, the last characters could be the start of the secret
     * and are dropped.
     */
    tail: (text: string, cutShort: boolean) => {
      const hidden = hide(text);
      return (cutShort && longest > 1 ? hidden.slice(0, 1 - longest) : hidden)
        .trim()
        .slice(-OUTPUT_TAIL_CHARACTERS);
    },
  };
};

const make = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const platform = yield* HostProcess.Platform;
  const hostEnvironment = yield* HostProcess.Environment;
  const processRunner = yield* ProcessRunner.ProcessRunner;
  const scope = yield* Effect.scope;

  const paths = clinicalPaths({
    baseDir: config.baseDir,
    platform,
    environment: hostEnvironment,
    join: path.join,
  });
  const m4Environment = {
    M4_DATA_DIR: paths.dataDir,
    // Without this, a crash inside M4 prints every local variable, and a
    // PhysioNet login is one of them.
    _TYPER_STANDARD_TRACEBACK: "1",
  };

  // M4's progress arrives through a synchronous stdout callback, so job state
  // is plain mutable state read by `list` rather than a Ref.
  const jobs = new Map<string, ClinicalDatasetJob>();
  /** What the last preparation of each dataset noted about its files, for as long as this server runs. */
  const notes = new Map<string, ReadonlyArray<string>>();
  const fibers = new Map<string, Fiber.Fiber<boolean>>();
  let listing: ReadonlyArray<ClinicalDataset> | undefined;
  /** Whether work was running when `listing` was read: its end makes the listing stale. */
  let listedWhileRunning = false;
  let demoIsReady = false;
  /** Whether M4 takes a login on standard input, for the M4 program file as it was when asked. */
  let knownCommands:
    | {
        readonly installedAt: number;
        readonly commands: ReadonlyMap<string, ReadonlyArray<string>>;
      }
    | undefined;
  /** Datasets whose files M4 is deleting, which no job may start on meanwhile. */
  const removing = new Set<string>();

  const requireM4 = fileSystem.exists(paths.m4).pipe(
    Effect.orElseSucceed(() => false),
    Effect.flatMap((installed) =>
      installed ? Effect.void : Effect.fail(new ClinicalDatasetsError({ message: NOT_INSTALLED })),
    ),
  );

  /** Runs an M4 command that only reports, and returns what it printed. */
  const askM4 = (args: ReadonlyArray<string>, timeout: ProcessRunner.ProcessRunInput["timeout"]) =>
    processRunner.run({
      command: paths.m4,
      args,
      env: m4Environment,
      timeout,
      outputMode: "truncate",
      maxOutputBytes: 256 * 1024,
    });

  const readM4Datasets = Effect.gen(function* () {
    const output = yield* askM4(["list-datasets", "--json", "--paths"], "60 seconds").pipe(
      Effect.mapError((cause) => new ClinicalDatasetsError({ message: LIST_UNREADABLE, cause })),
    );
    const report = yield* decodeM4DatasetList(output.stdout.trim()).pipe(
      Effect.mapError(
        () =>
          new ClinicalDatasetsError({
            message: LIST_UNREADABLE,
            detail: (output.stderr.trim() || output.stdout.trim()).slice(-OUTPUT_TAIL_CHARACTERS),
          }),
      ),
    );
    if (report.data === undefined) {
      return yield* new ClinicalDatasetsError({
        message: LIST_UNREADABLE,
        ...(report.error === undefined ? {} : { detail: report.error.message }),
      });
    }
    return report.data.datasets;
  });

  /**
   * The commands the installed M4 has, with their flags. Asked once per
   * installed M4: its program file changes when M4 does. Empty when M4 cannot
   * say, which counts as an M4 that has none of the newer ones.
   */
  const m4Commands = Effect.gen(function* () {
    const installedAt = yield* fileSystem.stat(paths.m4).pipe(
      Effect.map((info) => Option.getOrUndefined(info.mtime)?.getTime()),
      Effect.orElseSucceed(() => undefined),
    );
    if (knownCommands !== undefined && knownCommands.installedAt === installedAt) {
      return knownCommands.commands;
    }
    const commands = yield* askM4(["capabilities", "--json"], "60 seconds").pipe(
      Effect.map((output) =>
        Option.match(decodeM4Capabilities(output.stdout.trim()), {
          onNone: () => new Map<string, ReadonlyArray<string>>(),
          onSome: (capabilities) =>
            new Map(capabilities.commands.map((command) => [command.name, command.flags ?? []])),
        }),
      ),
      Effect.orElseSucceed(() => new Map<string, ReadonlyArray<string>>()),
    );
    if (installedAt !== undefined) knownCommands = { installedAt, commands };
    return commands;
  });

  /** Whether the installed M4 reads a login from its standard input itself. */
  const m4ReadsLoginFromStdin = Effect.map(
    m4Commands,
    (commands) => commands.get("download")?.includes(LOGIN_ON_STDIN) === true,
  );

  const actions: ClinicalDatasets["Service"]["actions"] = Effect.map(m4Commands, (commands) => ({
    define: commands.has("define-dataset"),
    remove: commands.has("remove-dataset"),
  }));

  /** The arguments that make M4 read a login from its standard input, where there is a way. */
  const loginArguments = Effect.gen(function* () {
    if (yield* m4ReadsLoginFromStdin) return Option.some([LOGIN_ON_STDIN]);
    // An older M4 reads the login from a path. Only macOS gives a child of
    // this server a standard input that can be opened as one.
    return platform === "darwin"
      ? Option.some(["--physionet-credentials-file", "/dev/stdin"])
      : Option.none<ReadonlyArray<string>>();
  });

  const readListing = Effect.gen(function* () {
    // Asked side by side: a client is waiting for the list.
    const [reported, canSendLogin] = yield* Effect.all(
      [readM4Datasets, platform === "darwin" ? Effect.succeed(true) : m4ReadsLoginFromStdin],
      { concurrency: 2 },
    );
    return reported.map((dataset): ClinicalDataset => {
      const agreementUrl = dataset.requires_authentication
        ? physioNetPage(dataset.dua_url ?? dataset.dataset_page_url)
        : undefined;
      return {
        name: dataset.name,
        ...aboutDataset(dataset),
        state:
          dataset.setup_state === "ready"
            ? "ready"
            : dataset.raw_present || dataset.parquet_present
              ? "incomplete"
              : "missing",
        requiresCredentials: dataset.requires_authentication,
        downloadable:
          dataset.download_available && (!dataset.requires_authentication || canSendLogin),
        ...(agreementUrl === undefined ? {} : { agreementUrl }),
        ...(typeof dataset.parquet_size_gb === "number" && dataset.parquet_size_gb > 0
          ? { sizeGb: dataset.parquet_size_gb }
          : {}),
      };
    });
  });

  /** The datasets whose preparation started here and has not completed. */
  const unfinished = fileSystem.readDirectory(paths.preparingDir).pipe(
    Effect.orElseSucceed((): ReadonlyArray<string> => []),
    Effect.map((names) => new Set(names)),
  );

  const list = Effect.gen(function* () {
    yield* requireM4;
    // Running work changes nothing M4 reports until it ends, and clients ask
    // every few seconds while it runs, so M4 is only asked in between.
    const running = [...jobs.values()].some((job) => job.state === "running");
    if (listing === undefined || !running || listedWhileRunning !== running) {
      listing = yield* readListing;
    }
    listedWhileRunning = running;
    const marked = yield* unfinished;
    const datasets = listing.map((dataset): ClinicalDataset => {
      const job = jobs.get(dataset.name);
      return {
        ...dataset,
        // M4 says ready as soon as some of a dataset is there; see the module comment.
        ...(dataset.state === "ready" && marked.has(dataset.name)
          ? { state: "incomplete" as const }
          : {}),
        ...(job === undefined ? {} : { job }),
        ...(notes.has(dataset.name) && dataset.state !== "missing"
          ? { notes: notes.get(dataset.name) }
          : {}),
      };
    });
    const demo = datasets.find((dataset) => dataset.name === DEMO_DATASET);
    if (demo !== undefined) demoIsReady = demo.state === "ready";
    return datasets;
  });

  /** Runs one M4 command to its end, feeding its progress events into the dataset's job. */
  const runM4 = Effect.fn("ClinicalDatasets.runM4")(function* (
    name: string,
    kind: WorkKind,
    args: ReadonlyArray<string>,
    login?: Login,
    /** Where progress goes instead of the dataset's job. */
    track?: (event: M4Event) => void,
  ) {
    let failure: M4Failure | undefined;
    let completed = false;
    const password = login === undefined ? undefined : Redacted.value(login.credentials.password);
    const secret = hiding(password);
    const output = yield* processRunner
      .run({
        command: paths.m4,
        args: [...args, ...(login?.arguments ?? []), "--json", "--events", "ndjson"],
        env: m4Environment,
        ...(login === undefined || password === undefined
          ? {}
          : {
              stdin: encodeM4Credentials({ username: login.credentials.username, password }),
            }),
        timeout: JOB_TIMEOUT,
        outputMode: "truncate",
        maxOutputBytes: 64 * 1024,
        onStdoutChunk: lineReader((line) => {
          const event = decodeM4Event(line);
          if (Option.isNone(event)) return;
          if (event.value.event === "operation_failed") failure = event.value.error;
          if (event.value.event === "operation_completed") completed = true;
          if (event.value.event === "conversion_warning") {
            const note = describeConversionWarning(event.value);
            if (note !== undefined) notes.set(name, [...(notes.get(name) ?? []), note]);
          }
          if (track !== undefined) {
            track(event.value);
            return;
          }
          const job = jobs.get(name);
          if (job !== undefined) jobs.set(name, advanceJob(job, event.value));
        }),
      })
      .pipe(
        Effect.mapError(
          (cause) => new ClinicalDatasetsError({ message: describeRunFailure(name, cause), cause }),
        ),
      );
    // Only M4 saying so counts as done: an exit without it prepared nothing for certain.
    if (completed && failure === undefined && output.code !== null && Number(output.code) === 0) {
      return;
    }
    const reported = [failure?.message, failure?.hint ?? undefined]
      .filter((part) => part !== undefined)
      .join(" ");
    const detail = secret.hide(reported) || secret.tail(output.stderr, output.stderrTruncated);
    return yield* new ClinicalDatasetsError({
      message: secret.hide(describeFailure(name, kind, failure?.code, login?.agreementUrl)),
      ...(detail.length === 0 ? {} : { detail }),
      ...(failure?.code === undefined ? {} : { code: failure.code }),
    });
  });

  /** A path with its links resolved, as far as it exists, so two spellings of one place compare equal. */
  const resolved = (target: string) =>
    fileSystem.realPath(target).pipe(
      // What is not there yet is named by its parent folder.
      Effect.catch(() =>
        fileSystem
          .realPath(path.dirname(target))
          .pipe(Effect.map((parent) => path.join(parent, path.basename(target)))),
      ),
      Effect.orElseSucceed(() => path.resolve(target)),
    );

  const isWithin = (parent: string, child: string) => {
    const relative = path.relative(parent, child);
    return (
      relative === "" ||
      (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
    );
  };

  /**
   * Removes what M4 made of a dataset, its converted files and its database,
   * at the paths M4 itself reports. Refuses instead of removing anything
   * outside M4's dataset store, anything at all when that store is one the
   * user chose instead of Lincei's own, or anything that holds, or lies in,
   * the raw files or a folder in `keep`.
   */
  const removePrepared = Effect.fn("ClinicalDatasets.removePrepared")(function* (
    name: string,
    keep: ReadonlyArray<string>,
    reported: M4Dataset | undefined,
  ) {
    const parquetRoot = reported?.parquet_root ?? "";
    const database = reported?.db_path ?? "";
    const notLinceisToRemove = () =>
      new ClinicalDatasetsError({
        message: `Lincei cannot clear what an earlier attempt left of ${name}, because M4 keeps those files outside Lincei's dataset storage on this computer. Nothing was changed. Ask whoever set up M4 here to remove the prepared files of ${name}. ${RETRY}`,
      });
    if (!path.isAbsolute(parquetRoot) || !path.isAbsolute(database)) {
      return yield* notLinceisToRemove();
    }

    const store = yield* resolved(paths.dataDir);
    // A store the user pointed M4 at themselves (M4_DATA_DIR) is theirs:
    // Lincei removes nothing outside its own home.
    if (!isWithin(yield* resolved(paths.home), store)) return yield* notLinceisToRemove();
    const parquet = yield* resolved(parquetRoot);
    const databaseFile = yield* resolved(database);
    const prepared = [parquet, databaseFile];
    const overlaps = (entry: string) =>
      prepared.some((target) => isWithin(target, entry) || isWithin(entry, target));
    const rawRoot = reported?.raw_root ?? "";
    if (
      prepared.some((target) => target === store || !isWithin(store, target)) ||
      (path.isAbsolute(rawRoot) && overlaps(yield* resolved(rawRoot)))
    ) {
      return yield* notLinceisToRemove();
    }
    for (const folder of keep) {
      if (overlaps(yield* resolved(folder))) {
        return yield* new ClinicalDatasetsError({
          message: `The folder you chose holds Lincei's own files for ${name}, so Lincei did not touch it. Choose the folder that holds only the raw files of ${name}.`,
          detail: folder,
        });
      }
    }

    yield* Effect.all(
      [
        fileSystem.remove(parquet, { recursive: true, force: true }),
        fileSystem.remove(databaseFile, { force: true }),
        // DuckDB's write-ahead log, which belongs to the database file beside it.
        fileSystem.remove(`${databaseFile}.wal`, { force: true }),
      ],
      { discard: true },
    ).pipe(
      Effect.mapError(
        (cause) =>
          new ClinicalDatasetsError({
            message: `Lincei could not remove what an earlier attempt left of ${name}. If an agent or another program is using this dataset, let it finish. ${RETRY}`,
            cause,
          }),
      ),
    );
  });

  /**
   * Lets M4 prepare a dataset: convert its raw files and build its database.
   * The mark it runs under is what keeps an interrupted run from passing for
   * a prepared dataset; see the module comment.
   *
   * M4 0.5.5 reuses whatever converted files it finds. So they are removed
   * first unless they are known to be complete: when the mark says a run here
   * did not finish, and also when they are there without a database, which is
   * what a conversion interrupted outside Lincei leaves (an agent's own, say).
   * A later M4 completes an unfinished dataset itself and is left to.
   */
  const prepare = Effect.fn("ClinicalDatasets.prepare")(function* (
    name: string,
    kind: JobKind,
    args: ReadonlyArray<string>,
    keep: ReadonlyArray<string>,
  ) {
    const markPath = path.join(paths.preparingDir, name);
    const reported = (yield* readM4Datasets).find((dataset) => dataset.name === name);
    const leftUnfinished =
      (yield* unfinished).has(name) ||
      (reported !== undefined && reported.parquet_present && reported.setup_state !== "ready");
    // Marked before anything of the dataset is touched, removal included.
    yield* fileSystem.makeDirectory(paths.preparingDir, { recursive: true }).pipe(
      Effect.andThen(fileSystem.writeFileString(markPath, MARK_NOTE)),
      Effect.mapError(
        (cause) =>
          new ClinicalDatasetsError({
            message: `Lincei could not get ready to prepare ${name}, so nothing was started. Check that the disk is not full. ${RETRY}`,
            cause,
          }),
      ),
    );
    // An M4 that reports `prepared` converts whatever is missing and never
    // leaves half a table under its final name, so there is nothing to clear.
    if (leftUnfinished && reported?.prepared === undefined) {
      yield* removePrepared(name, keep, reported);
    }
    yield* runM4(name, kind, args);
    yield* fileSystem.remove(markPath, { force: true }).pipe(
      Effect.mapError(
        (cause) =>
          new ClinicalDatasetsError({
            message: `M4 prepared ${name}, but Lincei could not record that it finished, so it still shows as incomplete. ${RETRY}`,
            cause,
          }),
      ),
    );
  });

  /** Downloads a dataset's raw files, then prepares them, which needs no login. */
  const downloadAndPrepare = (name: string, kind: JobKind, login?: Login) =>
    runM4(name, kind, ["download", name], login).pipe(
      Effect.andThen(prepare(name, kind, ["init", name, "--no-interactive"], [])),
    );

  /** What M4 would do to download a dataset, and what it makes of the raw folder in `target`. */
  const downloadPlan = (name: string, target?: string) =>
    askM4(
      [
        "download",
        name,
        ...(target === undefined ? [] : ["--target", target]),
        "--command-only",
        "--json",
      ],
      "2 minutes",
    ).pipe(Effect.map((output) => decodeM4DownloadPlan(output.stdout.trim())));

  /**
   * Fails unless M4 would send a login for this dataset to PhysioNet. A file
   * in M4's dataset store can replace a dataset's definition, its download
   * address included, and agents can write there. Answers the page where the
   * dataset's agreement is signed, which M4 0.5.7 names only here.
   */
  const requirePhysioNetSource = Effect.fn("ClinicalDatasets.requirePhysioNetSource")(function* (
    name: string,
  ) {
    const plan = Option.getOrUndefined(
      yield* downloadPlan(name).pipe(Effect.orElseSucceed(() => Option.none())),
    );
    const address = plan?.file_listing_url ?? undefined;
    const url = address === undefined || !URL.canParse(address) ? undefined : new URL(address);
    if (url === undefined) {
      return yield* new ClinicalDatasetsError({
        message: `Lincei could not confirm that ${name} downloads from physionet.org, so it did not send your PhysioNet login. Choose Download again; if it keeps failing, download the files from physionet.org and choose their folder instead.`,
      });
    }
    if (!isPhysioNet(url)) {
      return yield* new ClinicalDatasetsError({
        message: `The download address of ${name} was changed on this computer, so Lincei did not send your PhysioNet login. Download the files from physionet.org yourself and choose their folder instead, or ask whoever manages this computer to undo the change.`,
        detail: `M4 would download ${name} from ${url.protocol}//${url.host}.`,
      });
    }
    // M4 falls back to the file listing, which is no page to sign anything on.
    return plan?.access_url === address ? undefined : physioNetPage(plan?.access_url);
  });

  /**
   * Fails when M4's own check says the raw folder would not give this dataset
   * its tables: PhysioNet's folders still around it, files of another layout,
   * or none. M4 would convert such a folder for hours before failing.
   */
  const requireRawLayout = Effect.fn("ClinicalDatasets.requireRawLayout")(function* (
    name: string,
    source: string,
  ) {
    const plan = yield* downloadPlan(name, source).pipe(
      Effect.catch((cause) =>
        cause._tag === "ProcessTimeoutError"
          ? Effect.fail(
              new ClinicalDatasetsError({
                message: `That folder holds too much for Lincei to look through. Choose the folder that holds only the raw files of ${name}.`,
                detail: source,
                cause,
              }),
            )
          : // A folder M4 could not be asked about is still M4's to try; the mark covers the outcome.
            Effect.succeedNone,
      ),
    );
    if (Option.isNone(plan)) return;
    if (plan.value.error?.code === "dataset_not_found") {
      return yield* new ClinicalDatasetsError({ message: unknownDataset(name) });
    }
    const layout = plan.value.layout;
    if (layout === undefined) return;
    const detail = (layout.errors ?? []).join(" ").slice(0, OUTPUT_TAIL_CHARACTERS);
    if (layout.csv_gz_count === 0) {
      return yield* new ClinicalDatasetsError({
        message: describeFailure(name, "add", "raw_files_missing"),
        detail: source,
      });
    }
    if (
      !layout.ok &&
      (layout.errors ?? []).length === 0 &&
      (layout.empty_csv_gz ?? []).length > 0
    ) {
      return yield* new ClinicalDatasetsError({
        message: `Some files of ${name} in that folder are empty, so its download is not complete. Download them from physionet.org again, then choose Add dataset again.`,
        detail: (layout.empty_csv_gz ?? []).map(baseName).slice(0, 20).join(", "),
      });
    }
    if (!layout.ok || layout.warnings?.some((warning) => FILES_TOO_DEEP.has(warning)) === true) {
      return yield* new ClinicalDatasetsError({
        message: `That folder is not laid out the way ${name} is on PhysioNet. Choose the folder that directly holds the dataset's own folders and files; in a PhysioNet download it is the one named after the dataset's version number.`,
        ...(detail.length === 0 ? {} : { detail }),
      });
    }
  });

  /** A dataset name as M4 keys it, which is without regard to case. */
  const datasetName = (name: string) => {
    const normalized = name.toLowerCase();
    return DATASET_NAME.test(normalized)
      ? Effect.succeed(normalized)
      : Effect.fail(new ClinicalDatasetsError({ message: unknownDataset(name) }));
  };

  /** Runs `work` as the dataset's job in the server's scope and returns its fiber. */
  const start = Effect.fn("ClinicalDatasets.start")(function* (
    name: string,
    kind: JobKind,
    work: Effect.Effect<void, ClinicalDatasetsError>,
  ) {
    // Fail before there is a job, so the caller hears that nothing started.
    yield* requireM4;
    if (removing.has(name)) {
      return yield* new ClinicalDatasetsError({
        message: `${name} is being removed. Wait for that to finish, then try again.`,
      });
    }
    const current = jobs.get(name);
    if (current?.state === "running") {
      return yield* new ClinicalDatasetsError({
        message:
          current.kind === "setup"
            ? `${name} is already being downloaded while the clinical research tools are set up. Wait for it to finish.`
            : `${name} is already being prepared. Wait for it to finish, or cancel it first.`,
      });
    }
    const running: ClinicalDatasetJob = {
      kind,
      state: "running",
      phase: "starting",
      completed: 0,
      message: PHASE_MESSAGES.starting,
    };
    jobs.set(name, running);
    // What an earlier preparation noted is about files this one replaces.
    notes.delete(name);
    let self: Fiber.Fiber<boolean> | undefined;
    const fiber = yield* work.pipe(
      Effect.matchCauseEffect({
        onSuccess: () =>
          Effect.sync(() => {
            jobs.delete(name);
            listing = undefined;
            if (name === DEMO_DATASET) demoIsReady = true;
            return true;
          }),
        onFailure: (cause) => {
          // `cancel` already removed the job it interrupted.
          if (Cause.hasInterruptsOnly(cause)) return Effect.succeed(false);
          const error = Cause.findErrorOption(cause);
          return Effect.logWarning("clinical dataset job failed", {
            dataset: name,
            cause: Cause.pretty(cause),
          }).pipe(
            Effect.andThen(
              Effect.sync(() => {
                listing = undefined;
                jobs.set(name, {
                  ...(jobs.get(name) ?? running),
                  state: "failed",
                  message: Option.match(error, {
                    onNone: () => `Preparing ${name} stopped unexpectedly. ${RETRY}`,
                    onSome: (failure) => failure.message,
                  }),
                  ...Option.match(error, {
                    onNone: () => ({}),
                    onSome: (failure) =>
                      failure.detail === undefined ? {} : { detail: failure.detail },
                  }),
                });
                return false;
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

  /** Fails unless `source` is a folder on this machine, named by its full path. */
  const requireFolder = Effect.fn("ClinicalDatasets.requireFolder")(function* (source: string) {
    const isDirectory =
      path.isAbsolute(source) &&
      (yield* fileSystem.stat(source).pipe(
        Effect.map((info) => info.type === "Directory"),
        Effect.orElseSucceed(() => false),
      ));
    if (!isDirectory) {
      return yield* new ClinicalDatasetsError({
        message:
          "That folder does not exist on the computer Lincei runs on. Check the path, then choose the folder again.",
        detail: source,
      });
    }
  });

  const add: ClinicalDatasets["Service"]["add"] = (input) =>
    Effect.gen(function* () {
      const name = yield* datasetName(input.name);
      const { source } = input;
      yield* requireM4;
      yield* requireFolder(source);
      yield* requireRawLayout(name, source);
      return yield* start(
        name,
        "add",
        prepare(name, "add", ["init", name, "--src", source, "--no-interactive"], [source]),
      );
    });

  const download: ClinicalDatasets["Service"]["download"] = (input) =>
    Effect.gen(function* () {
      const name = yield* datasetName(input.name);
      const dataset = (yield* list).find((candidate) => candidate.name === name);
      if (dataset === undefined) {
        return yield* new ClinicalDatasetsError({ message: unknownDataset(input.name) });
      }
      // An open dataset is downloaded without a login even when one was sent.
      const credentials = dataset.requiresCredentials ? input.credentials : undefined;
      if (dataset.requiresCredentials && credentials === undefined) {
        return yield* new ClinicalDatasetsError({ message: loginRequired(name) });
      }
      if (credentials === undefined) {
        return yield* start(name, "download", downloadAndPrepare(name, "download"));
      }
      // Everything that can refuse does so before M4 is given the login.
      const how = yield* loginArguments;
      if (Option.isNone(how)) {
        return yield* new ClinicalDatasetsError({ message: loginNotPossible(name) });
      }
      const plannedAgreementUrl = yield* requirePhysioNetSource(name);
      return yield* start(
        name,
        "download",
        downloadAndPrepare(name, "download", {
          credentials,
          arguments: how.value,
          agreementUrl: dataset.agreementUrl ?? plannedAgreementUrl,
        }),
      );
    });

  const fetchImages: ClinicalDatasets["Service"]["fetchImages"] = (input) =>
    Effect.gen(function* () {
      const name = yield* datasetName(input.name);
      yield* requireM4;
      const fetchFlags = (yield* m4Commands).get("fetch-images");
      if (fetchFlags === undefined) {
        return yield* new ClinicalDatasetsError({
          message:
            "The installed clinical research tools cannot fetch images yet. Update them under Settings, Clinical Data, then ask the agent again.",
        });
      }
      if (removing.has(name)) {
        return yield* new ClinicalDatasetsError({
          message: `${name} is being removed, so no images are fetched from it.`,
        });
      }
      const dataset = (yield* list).find((candidate) => candidate.name === name);
      if (dataset === undefined) {
        return yield* new ClinicalDatasetsError({ message: unknownDataset(input.name) });
      }
      const credentials = dataset.requiresCredentials ? input.credentials : undefined;
      if (credentials !== undefined && !fetchFlags.includes(LOGIN_ON_STDIN)) {
        return yield* new ClinicalDatasetsError({ message: loginNotPossible(name) });
      }
      // As for a download: a definition an agent rewrote must not take the login elsewhere.
      const plannedAgreementUrl =
        credentials === undefined ? undefined : yield* requirePhysioNetSource(name);
      let progress: ClinicalDatasetJob = {
        kind: "download",
        state: "running",
        phase: "starting",
        completed: 0,
        message: "Fetching images.",
      };
      yield* runM4(
        name,
        "fetch",
        ["fetch-images", name, "--from-csv", input.list],
        credentials === undefined
          ? undefined
          : {
              credentials,
              arguments: [LOGIN_ON_STDIN],
              agreementUrl: dataset.agreementUrl ?? plannedAgreementUrl,
            },
        (event) => {
          progress = advanceJob(progress, event);
          input.onProgress?.(progress);
        },
      );
    });

  /** Why M4 would not define a dataset from a folder, in words for the person who chose it. */
  const describeDefinitionFailure = (name: string, failure: M4Failure | undefined) => {
    if (failure === undefined) {
      return `Lincei could not read what M4 made of that folder, so nothing was added. Try again. ${ASK_FOR_REPAIR}`;
    }
    switch (failure.code) {
      case "builtin_dataset":
      case "dataset_exists":
        return `There is already a dataset called "${name}". Choose another name.`;
      case "raw_files_missing":
        return "No CSV files (.csv or .csv.gz) were found in that folder or in the folders directly inside it. Choose the folder that holds them.";
      case "dataset_prepared":
        return `"${name}" still has prepared files on this computer. Remove it first, then add the folder again.`;
      case "invalid_dataset_name":
        return `"${name}" cannot be a dataset name. Use letters, digits and dashes.`;
      default:
        // M4 says what is wrong with the folder and how to fix it, such as a
        // file whose name cannot become a table, or files nested too deep.
        return [failure.message, failure.hint ?? undefined]
          .filter((part) => part !== undefined)
          .join(" ");
    }
  };

  const define: ClinicalDatasets["Service"]["define"] = (input) =>
    Effect.gen(function* () {
      const name = yield* datasetName(input.name);
      const { source } = input;
      const title = input.title.trim().slice(0, 200);
      yield* requireM4;
      yield* requireFolder(source);
      // Defining rewrites the definition, which must not change under a running job or a
      // dataset that is already here.
      const existing = (yield* list).find((dataset) => dataset.name === name);
      if (
        removing.has(name) ||
        existing?.job?.state === "running" ||
        (existing !== undefined && existing.state !== "missing")
      ) {
        return yield* new ClinicalDatasetsError({
          message: `There is already a dataset called "${name}" on this computer. Choose another name.`,
        });
      }
      const output = yield* askM4(
        [
          "define-dataset",
          name,
          "--src",
          source,
          // Joined, so a title that starts with a dash is not read as an option.
          ...(title.length === 0 ? [] : [`--title=${title}`]),
          "--json",
        ],
        "2 minutes",
      ).pipe(
        Effect.mapError(
          (cause) =>
            new ClinicalDatasetsError({
              message:
                cause._tag === "ProcessTimeoutError"
                  ? `That folder holds too much for Lincei to look through. Choose the folder that holds only the raw files of ${name}.`
                  : describeDefinitionFailure(name, undefined),
              cause,
            }),
        ),
      );
      const report = Option.getOrUndefined(decodeM4Outcome(output.stdout.trim()));
      if (report?.ok !== true) {
        const failure = report?.error;
        return yield* new ClinicalDatasetsError({
          message: describeDefinitionFailure(name, failure),
          detail:
            [failure?.message, failure?.hint ?? undefined]
              .filter((part) => part !== undefined)
              .join(" ") || output.stderr.trim().slice(-OUTPUT_TAIL_CHARACTERS),
        });
      }
      listing = undefined;
      return yield* start(
        name,
        "add",
        prepare(name, "add", ["init", name, "--src", source, "--no-interactive"], [source]),
      );
    });

  /** The program that shows a folder in this machine's file manager. */
  const fileManager =
    platform === "darwin" ? "open" : platform === "win32" ? "explorer" : "xdg-open";

  /**
   * The folder to show for a dataset: its prepared files where they are, as
   * M4 reports them, if they lie in M4's dataset store.
   */
  const datasetFolder = (name: string) =>
    Effect.gen(function* () {
      const reported = (yield* readM4Datasets).find((dataset) => dataset.name === name);
      const store = yield* resolved(paths.dataDir);
      for (const candidate of [reported?.parquet_root, reported?.raw_root]) {
        if (typeof candidate !== "string" || !path.isAbsolute(candidate)) continue;
        const folder = yield* resolved(candidate);
        const there = yield* fileSystem.exists(folder).pipe(Effect.orElseSucceed(() => false));
        if (there && isWithin(store, folder)) return folder;
      }
      return paths.dataDir;
    }).pipe(Effect.orElseSucceed(() => paths.dataDir));

  const openFolder: ClinicalDatasets["Service"]["openFolder"] = (input) =>
    Effect.gen(function* () {
      const folder =
        input === undefined ? paths.dataDir : yield* datasetFolder(yield* datasetName(input));
      yield* fileSystem.makeDirectory(folder, { recursive: true }).pipe(Effect.ignore);
      yield* processRunner
        .run({ command: fileManager, args: [folder], timeout: "10 seconds" })
        .pipe(
          Effect.catchTags({
            // Without the program there is no file manager to show the folder in.
            ProcessSpawnError: (cause) =>
              Effect.fail(
                new ClinicalDatasetsError({
                  message: `Lincei could not open the folder. It is ${folder}.`,
                  cause,
                }),
              ),
            // Explorer exits with a failure when it opened the folder, and a file
            // manager that stays open past the timeout has shown it too.
            ProcessTimeoutError: () => Effect.void,
            ProcessStdinError: () => Effect.void,
            ProcessReadError: () => Effect.void,
            ProcessOutputLimitError: () => Effect.void,
          }),
        );
    });

  /** Why M4 did not remove a dataset, in words for the person who asked. */
  const describeRemovalFailure = (name: string, failure: M4Failure | undefined) => {
    if (failure === undefined) {
      return `Lincei could not tell whether M4 removed ${name}. Look at the list again, and choose Remove again if it is still there. ${ASK_FOR_REPAIR}`;
    }
    switch (failure.code) {
      case "dataset_in_use":
        return `Lincei could not remove all of ${name}, because an agent or another program is using it. Let it finish, then choose Remove again.`;
      case "dataset_not_found":
        return unknownDataset(name);
      default:
        return [failure.message, failure.hint ?? undefined]
          .filter((part) => part !== undefined)
          .join(" ");
    }
  };

  const remove: ClinicalDatasets["Service"]["remove"] = (input) =>
    Effect.gen(function* () {
      const name = yield* datasetName(input);
      yield* requireM4;
      const job = jobs.get(name);
      if (job?.state === "running") {
        return yield* new ClinicalDatasetsError({
          message:
            job.kind === "setup"
              ? `${name} is being downloaded while the clinical research tools are set up. Wait for it to finish, then remove it.`
              : `${name} is being prepared. Cancel that first, then remove it.`,
        });
      }
      if (removing.has(name)) {
        return yield* new ClinicalDatasetsError({ message: `${name} is already being removed.` });
      }
      // Held from here until M4 has finished, so no job starts on files it is deleting.
      removing.add(name);
      const output = yield* askM4(["remove-dataset", name, "--json"], "2 minutes").pipe(
        Effect.mapError(
          (cause) =>
            new ClinicalDatasetsError({ message: describeRemovalFailure(name, undefined), cause }),
        ),
        Effect.ensuring(Effect.sync(() => removing.delete(name))),
      );
      // Whatever M4 managed to remove, the list has to be read again.
      listing = undefined;
      const report = Option.getOrUndefined(decodeM4Outcome(output.stdout.trim()));
      if (report?.ok !== true) {
        return yield* new ClinicalDatasetsError({
          message: describeRemovalFailure(name, report?.error),
          ...(output.stderr.trim().length === 0
            ? {}
            : { detail: output.stderr.trim().slice(-OUTPUT_TAIL_CHARACTERS) }),
        });
      }
      // Nothing is left to be unfinished, and a failure it showed is about files that are gone.
      jobs.delete(name);
      notes.delete(name);
      yield* fileSystem
        .remove(path.join(paths.preparingDir, name), { force: true })
        .pipe(Effect.ignore);
    });

  const cancel: ClinicalDatasets["Service"]["cancel"] = (input) =>
    Effect.gen(function* () {
      const name = input.toLowerCase();
      const job = jobs.get(name);
      // Setup's download of the demo ends with setup, not with a request.
      if (job?.kind === "setup" && job.state === "running") return;
      const fiber = fibers.get(name);
      jobs.delete(name);
      listing = undefined;
      if (fiber !== undefined) yield* Fiber.interrupt(fiber);
    });

  const prepareDemo = Effect.gen(function* () {
    const fiber =
      fibers.get(DEMO_DATASET) ??
      (yield* start(DEMO_DATASET, "setup", downloadAndPrepare(DEMO_DATASET, "setup")));
    const exit = yield* Fiber.await(fiber);
    return Exit.isSuccess(exit) && exit.value;
  }).pipe(
    Effect.catchTags({
      ClinicalDatasetsError: (error) =>
        Effect.logWarning("the demo dataset's download did not start", {
          reason: error.message,
        }).pipe(Effect.as(false)),
    }),
  );

  return ClinicalDatasets.of({
    list,
    actions,
    add,
    download,
    define,
    cancel,
    openFolder,
    remove,
    prepareDemo,
    demoReady: Effect.sync(() => demoIsReady),
    fetchImages,
  });
});

export const layer = Layer.effect(ClinicalDatasets, make);
