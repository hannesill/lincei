/**
 * Lincei's contract with its clients.
 *
 * Everything a client asks a Lincei server goes through one RPC carrying a
 * tagged request. T3 Code's RPC group, authorization map, and instrumentation
 * map each need an entry per method, so a method per feature would mean
 * editing those upstream files (and re-merging them) for every feature. A new
 * feature adds a member to the unions here instead.
 */
import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";

import { EnvironmentAuthorizationError } from "./auth.ts";

export const LINCEI_WS_METHODS = {
  request: "lincei.request",
} as const;

export const ClinicalProvisionStep = Schema.Literals([
  "uv",
  "python",
  "packages",
  "skills",
  "dataset",
]);
export type ClinicalProvisionStep = typeof ClinicalProvisionStep.Type;

export const ClinicalDemoDatasetState = Schema.Literals(["not-installed", "ready", "failed"]);
export type ClinicalDemoDatasetState = typeof ClinicalDemoDatasetState.Type;

/** The state of the clinical research tools Lincei installs and keeps current. */
export const ClinicalRuntimeStatus = Schema.Struct({
  /**
   * `ready` means the tools can be used. It is also the state after an update
   * of working tools failed: they keep working, `message` says so, and `step`
   * and `detail` describe the failed update as they do for `failed`.
   */
  state: Schema.Literals(["not-installed", "installing", "ready", "failed"]),
  /** The step in progress while installing, or the one that failed. */
  step: Schema.optional(ClinicalProvisionStep),
  /** What is happening, or what went wrong and what to do next, in words for the user. */
  message: Schema.String,
  /** The end of the failing command's output, for whoever helps the user. */
  detail: Schema.optional(Schema.String),
  home: Schema.String,
  python: Schema.String,
  skillsDir: Schema.String,
  dataDir: Schema.String,
  requirements: Schema.Array(Schema.String),
  demoDataset: ClinicalDemoDatasetState,
});
export type ClinicalRuntimeStatus = typeof ClinicalRuntimeStatus.Type;

/** A running Vitrine server showing the study kept in one working directory. */
export const ResearchBoard = Schema.Struct({
  /** Where a browser on the server's machine opens the board. */
  url: Schema.String,
  port: Schema.Number,
  /** The `.vitrine` directory the board reads, shared with the agents' cards. */
  dataDir: Schema.String,
});
export type ResearchBoard = typeof ResearchBoard.Type;

/**
 * How far a dataset is from being queryable: usable, partly prepared, or
 * absent. A dataset whose preparation was cancelled, interrupted, or failed is
 * `incomplete` until an Add or Download for it completes, whatever is on disk.
 */
export const ClinicalDatasetState = Schema.Literals(["ready", "incomplete", "missing"]);
export type ClinicalDatasetState = typeof ClinicalDatasetState.Type;

/** Work in progress on one dataset, or the reason its last attempt stopped. */
export const ClinicalDatasetJob = Schema.Struct({
  /**
   * `setup` is the demo dataset's download during clinical setup. It reports
   * progress like any other job, and is not one to cancel: it ends with setup.
   */
  kind: Schema.Literals(["add", "download", "setup"]),
  state: Schema.Literals(["running", "failed"]),
  phase: Schema.Literals(["starting", "downloading", "converting", "indexing"]),
  /** Files done in this phase, or tables while indexing. */
  completed: Schema.Number,
  total: Schema.optional(Schema.Number),
  /** The file being downloaded. */
  file: Schema.optional(
    Schema.Struct({
      name: Schema.String,
      bytes: Schema.Number,
      totalBytes: Schema.optional(Schema.Number),
    }),
  ),
  /** What is happening, or what went wrong and what to do next, in words for the user. */
  message: Schema.String,
  /** What M4 reported when the job failed, for whoever helps the user. */
  detail: Schema.optional(Schema.String),
});
export type ClinicalDatasetJob = typeof ClinicalDatasetJob.Type;

/**
 * A dataset M4 supports and what this machine holds of it. What it is
 * (`title` through `downloadSizeGb`) comes from M4's definition of it, which
 * an M4 before 0.5.8 does not report.
 */
export const ClinicalDataset = Schema.Struct({
  /** M4's id for it, which agents use. */
  name: Schema.String,
  title: Schema.optional(Schema.String),
  /** What it holds, from where and when, in a sentence or two. */
  summary: Schema.optional(Schema.String),
  /** The release M4 downloads. */
  version: Schema.optional(Schema.String),
  /** Its page on the web, to read more about it. Always https; `agreementUrl` is where to sign. */
  pageUrl: Schema.optional(Schema.String),
  /** About how much a download fetches. */
  downloadSizeGb: Schema.optional(Schema.Number),
  /** Defined on this computer, by the user or an agent, rather than shipped with M4. */
  custom: Schema.optional(Schema.Boolean),
  /**
   * What the last preparation on this server noted about how it read the
   * files, such as a column kept as text, in words for the user.
   */
  notes: Schema.optional(Schema.Array(Schema.String)),
  state: ClinicalDatasetState,
  /** Downloading it needs a PhysioNet account with access to this dataset. */
  requiresCredentials: Schema.Boolean,
  /**
   * Whether this server can download it. False for a dataset that needs a
   * PhysioNet login on a server that has no safe way to hand M4 one, so a
   * client offers only adding it from a folder there and never asks for a password.
   */
  downloadable: Schema.Boolean,
  /**
   * The page on physionet.org where an account signs this credentialed
   * dataset's data use agreement. Absent when M4 names none.
   */
  agreementUrl: Schema.optional(Schema.String),
  sizeGb: Schema.optional(Schema.Number),
  job: Schema.optional(ClinicalDatasetJob),
});
export type ClinicalDataset = typeof ClinicalDataset.Type;

/**
 * What a server can do with its datasets beyond listing, adding and
 * downloading them, which needs a Lincei and an M4 newer than those. A server
 * that sends no such description can do none of it, and also cannot open a
 * dataset's folder.
 */
export const ClinicalDatasetActions = Schema.Struct({
  /** M4 can define a dataset of the user's own files (`m4 define-dataset`). */
  define: Schema.Boolean,
  /** M4 can delete what it prepared of a dataset (`m4 remove-dataset`). */
  remove: Schema.Boolean,
});
export type ClinicalDatasetActions = typeof ClinicalDatasetActions.Type;

/**
 * A PhysioNet login for one download. The server passes it to M4 and keeps
 * nothing. The password decodes to a redacted value, so a request that is
 * logged, traced, or printed shows `<redacted>` in its place.
 */
export const PhysioNetCredentials = Schema.Struct({
  username: Schema.String,
  password: Schema.RedactedFromValue(Schema.String),
});
export type PhysioNetCredentials = typeof PhysioNetCredentials.Type;

/**
 * What a Lincei user has chosen that the server acts on. With Techie mode off,
 * the default, agents are told they work with a researcher and the clients
 * hide developer surfaces; with it on, Lincei is upstream's full feature set.
 */
export const LinceiPreferences = Schema.Struct({ techieMode: Schema.Boolean });
export type LinceiPreferences = typeof LinceiPreferences.Type;

/** One of M4's skills, as Lincei offers it to agents. */
export const ClinicalSkill = Schema.Struct({
  name: Schema.String,
  /** M4's grouping, such as `clinical` or `system`. */
  category: Schema.String,
  /** What an agent matches a task against. */
  description: Schema.String,
  /** A skill of the user's has this name, and agents that load skills by name get theirs. */
  shadowed: Schema.Boolean,
});
export type ClinicalSkill = typeof ClinicalSkill.Type;

/**
 * Whether Lincei keeps a history of a project's folder, which is what lets a
 * researcher undo the agent's changes to its files.
 *
 * - `on`: Lincei made the folder a git repository with data kept out of it.
 * - `off`: a plain folder; it can be turned on.
 * - `own`: the folder is, or is inside, a git repository Lincei did not make.
 *   That keeps the history, and Lincei never changes it.
 * - `unavailable`: Lincei keeps no history here; `message` says why.
 */
export const StudyHistory = Schema.Struct({
  state: Schema.Literals(["on", "off", "own", "unavailable"]),
  /** What the state means, or why the switch cannot be used, in words for the researcher. */
  message: Schema.String,
  /** Files kept out of the history for their size, relative to the folder. */
  leftOut: Schema.Array(Schema.String),
});
export type StudyHistory = typeof StudyHistory.Type;

export const LinceiRequest = Schema.Union([
  /** Reads the state of the clinical research tools. */
  Schema.TaggedStruct("ClinicalStatus", {}),
  /**
   * Starts installing, updating, or completing the clinical research tools in
   * the background, and answers with the state of that run. `force` installs
   * everything again, to repair tools that are installed but do not work.
   */
  Schema.TaggedStruct("ClinicalSetup", { force: Schema.optional(Schema.Boolean) }),
  /** Starts the research board for the study in `cwd`, or finds the one running. */
  Schema.TaggedStruct("ResearchBoardOpen", { cwd: Schema.String }),
  /** Reads when the study in `cwd` last gained or changed a card, without starting anything. */
  Schema.TaggedStruct("ResearchBoardActivity", { cwd: Schema.String }),
  /** Lists M4's datasets with what this machine holds of each. */
  Schema.TaggedStruct("ClinicalDatasets", {}),
  /** Starts preparing a dataset from raw files already in `source`, a folder on the server. */
  Schema.TaggedStruct("ClinicalDatasetAdd", { name: Schema.String, source: Schema.String }),
  /**
   * Defines a dataset of the user's own from the files in `source`, a folder
   * on the server, and starts preparing it. M4 works out its tables from the
   * folder; `name` is the id agents use, `title` what people read.
   */
  Schema.TaggedStruct("ClinicalDatasetDefine", {
    name: Schema.String,
    title: Schema.String,
    source: Schema.String,
  }),
  /**
   * Opens a folder in the file manager on the server's own screen: the one
   * that holds the prepared datasets, or with `name` that dataset's own.
   */
  Schema.TaggedStruct("ClinicalDataFolderOpen", { name: Schema.optional(Schema.String) }),
  /**
   * Deletes what was prepared of a dataset, and the definition of one defined
   * on this computer. Raw files the user pointed at are never touched.
   */
  Schema.TaggedStruct("ClinicalDatasetRemove", { name: Schema.String }),
  /** Starts downloading and preparing a dataset. Credentialed datasets need the login. */
  Schema.TaggedStruct("ClinicalDatasetDownload", {
    name: Schema.String,
    credentials: Schema.optional(PhysioNetCredentials),
  }),
  /** Stops a dataset's running job, or clears its failed one. Finished files are kept. */
  Schema.TaggedStruct("ClinicalDatasetCancel", { name: Schema.String }),
  /** Reads the user's preferences. */
  Schema.TaggedStruct("Preferences", {}),
  /** Changes them. Agents are told from their next turn; other clients see it when they next ask. */
  Schema.TaggedStruct("PreferencesUpdate", { techieMode: Schema.Boolean }),
  /** Reads what Lincei gives every agent: its instructions for the current mode, and M4's skills. */
  Schema.TaggedStruct("AgentBriefing", {}),
  /** Reads the full text of one of M4's skills. */
  Schema.TaggedStruct("ClinicalSkillText", { name: Schema.String }),
  /** Reads whether Lincei keeps a history of `folder`, a project folder on the server. */
  Schema.TaggedStruct("StudyHistory", { folder: Schema.String }),
  /**
   * Starts or stops keeping that history. Stopping keeps what was recorded,
   * and starting again brings it back.
   */
  Schema.TaggedStruct("StudyHistoryUpdate", { folder: Schema.String, on: Schema.Boolean }),
]);
export type LinceiRequest = typeof LinceiRequest.Type;

export const LinceiResponse = Schema.Union([
  /**
   * The state of the clinical research tools. Also the answer to a request
   * that needs them before they are installed, so the client can show what it
   * is waiting for.
   */
  Schema.TaggedStruct("Clinical", { status: ClinicalRuntimeStatus }),
  Schema.TaggedStruct("ResearchBoard", { board: ResearchBoard }),
  /** `updatedAt` is in epoch milliseconds, and absent while the study has no cards. */
  Schema.TaggedStruct("ResearchBoardActivity", { updatedAt: Schema.optional(Schema.Number) }),
  Schema.TaggedStruct("ClinicalDatasets", {
    datasets: Schema.Array(ClinicalDataset),
    actions: Schema.optional(ClinicalDatasetActions),
  }),
  /** A request that changed nothing a client shows went through. */
  Schema.TaggedStruct("Done", {}),
  Schema.TaggedStruct("Preferences", { preferences: LinceiPreferences }),
  Schema.TaggedStruct("AgentBriefing", {
    /** What Lincei adds to every agent session's instructions, as of the next turn. */
    instructions: Schema.String,
    techieMode: Schema.Boolean,
    skills: Schema.Array(ClinicalSkill),
  }),
  Schema.TaggedStruct("ClinicalSkillText", { name: Schema.String, text: Schema.String }),
  Schema.TaggedStruct("StudyHistory", { history: StudyHistory }),
]);
export type LinceiResponse = typeof LinceiResponse.Type;

export class LinceiRequestError extends Schema.TaggedError<LinceiRequestError>()(
  "LinceiRequestError",
  {
    /** What went wrong and what to do next, in words for the user. */
    message: Schema.String,
    /** Technical output, for whoever helps the user. Never needed to act on `message`. */
    detail: Schema.optional(Schema.String),
  },
) {}

export const WsLinceiRequestRpc = Rpc.make(LINCEI_WS_METHODS.request, {
  payload: LinceiRequest,
  success: LinceiResponse,
  error: Schema.Union([LinceiRequestError, EnvironmentAuthorizationError]),
});
