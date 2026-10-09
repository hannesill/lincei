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

/** The state of the Python environment Lincei manages for clinical research. */
export const ClinicalRuntimeStatus = Schema.Struct({
  state: Schema.Literals(["not-installed", "installing", "ready", "failed"]),
  /** The step in progress while installing, or the one that failed. */
  step: Schema.optional(ClinicalProvisionStep),
  message: Schema.String,
  /** The end of the failing command's output. */
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

/** How far a dataset is from being queryable: usable, partly prepared, or absent. */
export const ClinicalDatasetState = Schema.Literals(["ready", "incomplete", "missing"]);
export type ClinicalDatasetState = typeof ClinicalDatasetState.Type;

/** Work in progress on one dataset, or the reason its last attempt stopped. */
export const ClinicalDatasetJob = Schema.Struct({
  /** `setup` is the demo dataset's download during clinical setup, which is not a job to cancel. */
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
  /** What is happening, or what went wrong, in words for the user. */
  message: Schema.String,
  /** What M4 reported when the job failed. */
  detail: Schema.optional(Schema.String),
});
export type ClinicalDatasetJob = typeof ClinicalDatasetJob.Type;

/** A dataset M4 supports and what this machine holds of it. */
export const ClinicalDataset = Schema.Struct({
  name: Schema.String,
  state: ClinicalDatasetState,
  /** Downloading it needs a PhysioNet account with access to this dataset. */
  requiresCredentials: Schema.Boolean,
  downloadable: Schema.Boolean,
  sizeGb: Schema.optional(Schema.Number),
  job: Schema.optional(ClinicalDatasetJob),
});
export type ClinicalDataset = typeof ClinicalDataset.Type;

export const LinceiRequest = Schema.Union([
  /** Reads the clinical runtime's state. */
  Schema.TaggedStruct("ClinicalStatus", {}),
  /** Starts installing or repairing the clinical runtime in the background. */
  Schema.TaggedStruct("ClinicalSetup", {}),
  /** Starts the research board for the study in `cwd`, or finds the one running. */
  Schema.TaggedStruct("ResearchBoardOpen", { cwd: Schema.String }),
  /** Reads when the study in `cwd` last gained or changed a card, without starting anything. */
  Schema.TaggedStruct("ResearchBoardActivity", { cwd: Schema.String }),
  /** Lists M4's datasets with what this machine holds of each. */
  Schema.TaggedStruct("ClinicalDatasets", {}),
  /** Starts preparing a dataset from raw files already in `source`, a folder on the server. */
  Schema.TaggedStruct("ClinicalDatasetAdd", { name: Schema.String, source: Schema.String }),
  /** Starts downloading and preparing a dataset. */
  Schema.TaggedStruct("ClinicalDatasetDownload", { name: Schema.String }),
  /** Stops a dataset's running job, or clears its failed one. Finished files are kept. */
  Schema.TaggedStruct("ClinicalDatasetCancel", { name: Schema.String }),
]);
export type LinceiRequest = typeof LinceiRequest.Type;

export const LinceiResponse = Schema.Union([
  /**
   * The clinical runtime's state. Also the answer to a request that needs the
   * runtime before it is ready, so the client can show what it is waiting for.
   */
  Schema.TaggedStruct("Clinical", { status: ClinicalRuntimeStatus }),
  Schema.TaggedStruct("ResearchBoard", { board: ResearchBoard }),
  /** `updatedAt` is in epoch milliseconds, and absent while the study has no cards. */
  Schema.TaggedStruct("ResearchBoardActivity", { updatedAt: Schema.optional(Schema.Number) }),
  Schema.TaggedStruct("ClinicalDatasets", { datasets: Schema.Array(ClinicalDataset) }),
]);
export type LinceiResponse = typeof LinceiResponse.Type;

export class LinceiRequestError extends Schema.TaggedError<LinceiRequestError>()(
  "LinceiRequestError",
  {
    message: Schema.String,
    detail: Schema.optional(Schema.String),
  },
) {}

export const WsLinceiRequestRpc = Rpc.make(LINCEI_WS_METHODS.request, {
  payload: LinceiRequest,
  success: LinceiResponse,
  error: Schema.Union([LinceiRequestError, EnvironmentAuthorizationError]),
});
