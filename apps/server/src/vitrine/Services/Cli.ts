import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

export type VitrineCliAction = "start" | "status" | "stop";

export interface VitrineCliInput {
  readonly workspaceRoot: string;
}

export interface VitrineCliRunningSnapshot {
  readonly status: "running";
  readonly url: string;
  readonly apiUrl: string;
  readonly pid: number;
  readonly port: number;
  readonly sessionId: string;
  readonly dataDir: string;
  readonly version: string;
}

export interface VitrineCliStoppedSnapshot {
  readonly status: "stopped";
  readonly dataDir: string;
  readonly version: string | null;
}

export type VitrineCliSnapshot = VitrineCliRunningSnapshot | VitrineCliStoppedSnapshot;

export type VitrineCliIssueCode =
  | "executable_unavailable"
  | "startup_timeout"
  | "process_exited"
  | "invalid_status_payload"
  | "non_loopback_url"
  | "project_mismatch"
  | "incompatible_version"
  | "command_failed";

export class VitrineCliError extends Error {
  readonly action: VitrineCliAction;
  readonly code: VitrineCliIssueCode;
  readonly detail: string;
  override readonly cause?: unknown;

  constructor(input: {
    readonly action: VitrineCliAction;
    readonly code: VitrineCliIssueCode;
    readonly detail: string;
    readonly cause?: unknown;
  }) {
    super(input.detail);
    this.name = "VitrineCliError";
    this.action = input.action;
    this.code = input.code;
    this.detail = input.detail;
    if (input.cause !== undefined) this.cause = input.cause;
  }
}

export interface VitrineCliShape {
  readonly run: (
    action: VitrineCliAction,
    input: VitrineCliInput,
  ) => Effect.Effect<VitrineCliSnapshot, VitrineCliError>;
}

export class VitrineCli extends Context.Service<VitrineCli, VitrineCliShape>()(
  "t3/vitrine/Services/Cli/VitrineCli",
) {}
