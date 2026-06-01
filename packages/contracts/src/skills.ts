import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { IsoDateTime, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { ProviderDriverKind } from "./providerInstance.ts";

export const LinceiSkillCategory = Schema.Literals([
  "api",
  "cards",
  "workflow",
  "clinical-methods",
  "provider-native",
]);
export type LinceiSkillCategory = typeof LinceiSkillCategory.Type;

export const LinceiSkillTier = Schema.Literals(["bundled", "project", "provider-native"]);
export type LinceiSkillTier = typeof LinceiSkillTier.Type;

export const LinceiSkillSource = Schema.Literals(["bundled", "project", "provider-native"]);
export type LinceiSkillSource = typeof LinceiSkillSource.Type;

export const LinceiSkillSyncState = Schema.Literals([
  "current",
  "outdated",
  "target-modified",
  "missing",
  "unmanaged",
  "conflict",
  "prompt-fallback",
  "unavailable",
]);
export type LinceiSkillSyncState = typeof LinceiSkillSyncState.Type;

export const LinceiSkillDeploymentTarget = Schema.Struct({
  provider: ProviderDriverKind,
  path: TrimmedNonEmptyString,
  status: LinceiSkillSyncState,
  syncedAt: Schema.optional(IsoDateTime),
});
export type LinceiSkillDeploymentTarget = typeof LinceiSkillDeploymentTarget.Type;

export const LinceiCanonicalSkill = Schema.Struct({
  id: TrimmedNonEmptyString,
  title: TrimmedNonEmptyString,
  description: TrimmedNonEmptyString,
  category: LinceiSkillCategory,
  tier: LinceiSkillTier,
  version: TrimmedNonEmptyString,
  source: LinceiSkillSource,
  enabled: Schema.Boolean,
  body: Schema.String,
  contentHash: TrimmedNonEmptyString,
  upstreamId: Schema.optional(TrimmedNonEmptyString),
  upstreamVersion: Schema.optional(TrimmedNonEmptyString),
  deploymentTargets: Schema.Array(LinceiSkillDeploymentTarget).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
});
export type LinceiCanonicalSkill = typeof LinceiCanonicalSkill.Type;

export const LinceiSkillSyncSidecar = Schema.Struct({
  skillId: TrimmedNonEmptyString,
  contentHash: TrimmedNonEmptyString,
  version: TrimmedNonEmptyString,
  targetProvider: ProviderDriverKind,
  targetPath: TrimmedNonEmptyString,
  syncedAt: IsoDateTime,
  lastSeenTargetHash: TrimmedNonEmptyString,
  installMode: Schema.Literal("managed-copy"),
});
export type LinceiSkillSyncSidecar = typeof LinceiSkillSyncSidecar.Type;

export const LinceiWorkflowId = Schema.Literals([
  "ad-hoc",
  "structured-clinical-study",
  "replication-validation",
  "review-only",
]);
export type LinceiWorkflowId = typeof LinceiWorkflowId.Type;

export const LinceiWorkflow = Schema.Struct({
  id: LinceiWorkflowId,
  title: TrimmedNonEmptyString,
  version: TrimmedNonEmptyString,
  description: TrimmedNonEmptyString,
  skillIds: Schema.Array(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  body: Schema.String,
});
export type LinceiWorkflow = typeof LinceiWorkflow.Type;
