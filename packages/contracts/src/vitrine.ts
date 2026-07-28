import * as Schema from "effect/Schema";

import { IsoDateTime, ProjectId, TrimmedNonEmptyString } from "./baseSchemas.ts";

export const VitrineRuntimeSource = Schema.Literals(["environment", "settings", "path"]);
export type VitrineRuntimeSource = typeof VitrineRuntimeSource.Type;

export const VitrineRuntimeStatusKind = Schema.Literals([
  "ready",
  "unavailable",
  "incompatible",
  "failed",
]);
export type VitrineRuntimeStatusKind = typeof VitrineRuntimeStatusKind.Type;

export const VitrineRuntimeStatus = Schema.Struct({
  status: VitrineRuntimeStatusKind,
  source: VitrineRuntimeSource,
  executable: TrimmedNonEmptyString,
  version: Schema.NullOr(TrimmedNonEmptyString),
  lifecycleContractVersion: Schema.NullOr(Schema.Int.check(Schema.isGreaterThan(0))),
  pythonExecutable: Schema.NullOr(TrimmedNonEmptyString),
  supportedVersionRange: TrimmedNonEmptyString,
  requiredLifecycleContractVersion: Schema.Int.check(Schema.isGreaterThan(0)),
  message: Schema.NullOr(TrimmedNonEmptyString),
  checkedAt: IsoDateTime,
});
export type VitrineRuntimeStatus = typeof VitrineRuntimeStatus.Type;

export const VitrineLifecycleStatus = Schema.Literals([
  "unavailable",
  "starting",
  "ready",
  "failed",
  "stopped",
]);
export type VitrineLifecycleStatus = typeof VitrineLifecycleStatus.Type;

export const VitrineLifecycleIssueCode = Schema.Literals([
  "executable_unavailable",
  "startup_timeout",
  "process_exited",
  "invalid_status_payload",
  "non_loopback_url",
  "project_mismatch",
  "incompatible_version",
  "command_failed",
]);
export type VitrineLifecycleIssueCode = typeof VitrineLifecycleIssueCode.Type;

export const VitrineProjectState = Schema.Struct({
  projectId: ProjectId,
  status: VitrineLifecycleStatus,
  dataDir: TrimmedNonEmptyString,
  url: Schema.NullOr(TrimmedNonEmptyString),
  apiUrl: Schema.NullOr(TrimmedNonEmptyString),
  pid: Schema.NullOr(Schema.Int.check(Schema.isGreaterThan(0))),
  port: Schema.NullOr(Schema.Int.check(Schema.isGreaterThan(0)).check(Schema.isLessThan(65_536))),
  sessionId: Schema.NullOr(TrimmedNonEmptyString),
  version: Schema.NullOr(TrimmedNonEmptyString),
  issueCode: Schema.NullOr(VitrineLifecycleIssueCode),
  message: Schema.NullOr(TrimmedNonEmptyString),
  updatedAt: IsoDateTime,
});
export type VitrineProjectState = typeof VitrineProjectState.Type;

export const VitrineProjectInput = Schema.Struct({
  projectId: ProjectId,
});
export type VitrineProjectInput = typeof VitrineProjectInput.Type;

export class VitrineLifecycleError extends Schema.TaggedErrorClass<VitrineLifecycleError>()(
  "VitrineLifecycleError",
  {
    projectId: ProjectId,
    code: Schema.Literals([
      "project_not_found",
      "project_lookup_failed",
      "browser_policy_unsupported",
      "browser_url_invalid",
      "browser_launch_failed",
    ]),
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {}
