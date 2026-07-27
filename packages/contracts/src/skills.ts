import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { IsoDateTime, NonNegativeInt, TrimmedNonEmptyString } from "./baseSchemas.ts";

export const LinceiSkillCategory = Schema.Literals([
  "api",
  "workflow",
  "clinical-methods",
  "provider-native",
]);
export type LinceiSkillCategory = typeof LinceiSkillCategory.Type;

export const LinceiSkillTier = Schema.Literals(["bundled", "project", "provider-native"]);
export type LinceiSkillTier = typeof LinceiSkillTier.Type;

export const LinceiSkillSource = Schema.Literals(["bundled", "project", "provider-native"]);
export type LinceiSkillSource = typeof LinceiSkillSource.Type;

export const ManagedSkillKind = Schema.Literals([
  "domain",
  "methodology",
  "integration",
  "workflow",
  "maintenance",
  "authoring",
]);
export type ManagedSkillKind = typeof ManagedSkillKind.Type;

export const ManagedSkillSource = Schema.Literals([
  "bundled",
  "managed-cache",
  "provider-native",
  "project",
]);
export type ManagedSkillSource = typeof ManagedSkillSource.Type;

export const ManagedSkillActivationPolicy = Schema.Literals([
  "eligible",
  "workflow-required",
  "opt-in",
  "suppressed",
]);
export type ManagedSkillActivationPolicy = typeof ManagedSkillActivationPolicy.Type;

export const ManagedSkillDeliveryState = Schema.Literals([
  "managed-cache",
  "provider-native",
  "local-override",
  "unavailable",
  "stale",
]);
export type ManagedSkillDeliveryState = typeof ManagedSkillDeliveryState.Type;

export const ManagedSkillFileDescriptor = Schema.Struct({
  path: TrimmedNonEmptyString,
  size: NonNegativeInt,
  contentDigest: TrimmedNonEmptyString,
});
export type ManagedSkillFileDescriptor = typeof ManagedSkillFileDescriptor.Type;

export const ManagedSkillDescriptor = Schema.Struct({
  id: TrimmedNonEmptyString,
  publisher: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  title: TrimmedNonEmptyString,
  description: TrimmedNonEmptyString,
  kind: ManagedSkillKind,
  category: TrimmedNonEmptyString,
  tier: TrimmedNonEmptyString,
  bundleVersion: TrimmedNonEmptyString,
  contentDigest: TrimmedNonEmptyString,
  treeDigest: TrimmedNonEmptyString,
  relativeRoot: TrimmedNonEmptyString,
  files: Schema.Array(ManagedSkillFileDescriptor),
  source: ManagedSkillSource,
  enabled: Schema.Boolean,
  activationPolicy: ManagedSkillActivationPolicy,
  deliveryState: ManagedSkillDeliveryState,
  stale: Schema.Boolean,
  body: Schema.String,
  nativeTreeDigest: Schema.optional(TrimmedNonEmptyString),
  conflictPath: Schema.optional(TrimmedNonEmptyString),
});
export type ManagedSkillDescriptor = typeof ManagedSkillDescriptor.Type;

export const SkillCatalogSourceState = Schema.Literals(["ready", "stale", "unavailable"]);
export type SkillCatalogSourceState = typeof SkillCatalogSourceState.Type;

export const SkillCatalogSourceStatus = Schema.Struct({
  publisher: TrimmedNonEmptyString,
  state: SkillCatalogSourceState,
  bundleVersion: Schema.optional(TrimmedNonEmptyString),
  bundleDigest: Schema.optional(TrimmedNonEmptyString),
  message: Schema.optional(TrimmedNonEmptyString),
});
export type SkillCatalogSourceStatus = typeof SkillCatalogSourceStatus.Type;

export const SkillCatalogSnapshot = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  refreshedAt: IsoDateTime,
  skills: Schema.Array(ManagedSkillDescriptor),
  sources: Schema.Array(SkillCatalogSourceStatus),
});
export type SkillCatalogSnapshot = typeof SkillCatalogSnapshot.Type;

export const EMPTY_SKILL_CATALOG: SkillCatalogSnapshot = {
  schemaVersion: 1,
  refreshedAt: "1970-01-01T00:00:00.000Z",
  skills: [],
  sources: [],
};

export const SkillBundlePin = Schema.Struct({
  publisher: TrimmedNonEmptyString,
  bundleVersion: TrimmedNonEmptyString,
  bundleDigest: TrimmedNonEmptyString,
});
export type SkillBundlePin = typeof SkillBundlePin.Type;

export const SessionSkillSelection = Schema.Struct({
  workflowId: Schema.optional(TrimmedNonEmptyString),
  workflowVersion: Schema.optional(TrimmedNonEmptyString),
  bundlePins: Schema.Array(SkillBundlePin),
  skillIds: Schema.Array(TrimmedNonEmptyString),
});
export type SessionSkillSelection = typeof SessionSkillSelection.Type;

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
});
export type LinceiCanonicalSkill = typeof LinceiCanonicalSkill.Type;

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
