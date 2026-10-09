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

export const LinceiRequest = Schema.Union([
  /** Reads the clinical runtime's state. */
  Schema.TaggedStruct("ClinicalStatus", {}),
  /** Starts installing or repairing the clinical runtime in the background. */
  Schema.TaggedStruct("ClinicalSetup", {}),
  /** Starts the research board for the study in `cwd`, or finds the one running. */
  Schema.TaggedStruct("ResearchBoardOpen", { cwd: Schema.String }),
]);
export type LinceiRequest = typeof LinceiRequest.Type;

export const LinceiResponse = Schema.Union([
  /**
   * The clinical runtime's state. Also the answer to a request that needs the
   * runtime before it is ready, so the client can show what it is waiting for.
   */
  Schema.TaggedStruct("Clinical", { status: ClinicalRuntimeStatus }),
  Schema.TaggedStruct("ResearchBoard", { board: ResearchBoard }),
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
