import * as Schema from "effect/Schema";

import {
  IsoDateTime,
  NonNegativeInt,
  ResearchCardId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";
import {
  OrchestrationResearchCard,
  ResearchCardArtifactKind,
  ResearchCardArtifactReference,
} from "./orchestration.ts";

export const ResearchStudySchemaVersion = Schema.Literal(1);
export type ResearchStudySchemaVersion = typeof ResearchStudySchemaVersion.Type;

export const ResearchStudyId = TrimmedNonEmptyString.pipe(Schema.brand("ResearchStudyId"));
export type ResearchStudyId = typeof ResearchStudyId.Type;

export const ResearchRunId = TrimmedNonEmptyString.pipe(Schema.brand("ResearchRunId"));
export type ResearchRunId = typeof ResearchRunId.Type;

export const ResearchArtifactId = TrimmedNonEmptyString.pipe(Schema.brand("ResearchArtifactId"));
export type ResearchArtifactId = typeof ResearchArtifactId.Type;

export const ResearchContentHash = TrimmedNonEmptyString.pipe(Schema.brand("ResearchContentHash"));
export type ResearchContentHash = typeof ResearchContentHash.Type;

export const StudyRelativePath = TrimmedNonEmptyString.pipe(Schema.brand("StudyRelativePath"));
export type StudyRelativePath = typeof StudyRelativePath.Type;

export const ResearchStudyManifest = Schema.Struct({
  schemaVersion: ResearchStudySchemaVersion,
  studyId: ResearchStudyId,
  title: TrimmedNonEmptyString,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type ResearchStudyManifest = typeof ResearchStudyManifest.Type;

export const ResearchCardDependencyStatus = Schema.Literals([
  "current",
  "stale",
  "missing",
  "dirty-source",
  "unknown",
]);
export type ResearchCardDependencyStatus = typeof ResearchCardDependencyStatus.Type;

export const ResearchCardDependencyKind = Schema.Literals([
  "source",
  "script",
  "query",
  "dataset",
  "artifact",
  "other",
]);
export type ResearchCardDependencyKind = typeof ResearchCardDependencyKind.Type;

export const ResearchCardDependencyLineRange = Schema.Struct({
  start: NonNegativeInt,
  end: Schema.optional(NonNegativeInt),
});
export type ResearchCardDependencyLineRange = typeof ResearchCardDependencyLineRange.Type;

export const ResearchCardDependency = Schema.Struct({
  id: TrimmedNonEmptyString,
  kind: ResearchCardDependencyKind,
  relativePath: StudyRelativePath,
  lineRange: Schema.optional(ResearchCardDependencyLineRange),
  role: Schema.optional(TrimmedNonEmptyString),
  contentHash: Schema.optional(ResearchContentHash),
  gitBlob: Schema.optional(TrimmedNonEmptyString),
  gitCommit: Schema.optional(TrimmedNonEmptyString),
});
export type ResearchCardDependency = typeof ResearchCardDependency.Type;

export const ResearchCardConsistency = Schema.Struct({
  status: ResearchCardDependencyStatus,
  checkedAt: IsoDateTime,
  details: Schema.optional(Schema.String),
});
export type ResearchCardConsistency = typeof ResearchCardConsistency.Type;

export const ResearchArtifactManifest = Schema.Struct({
  schemaVersion: ResearchStudySchemaVersion,
  id: ResearchArtifactId,
  kind: ResearchCardArtifactKind,
  relativePath: StudyRelativePath,
  mimeType: Schema.optional(TrimmedNonEmptyString),
  size: NonNegativeInt,
  contentHash: ResearchContentHash,
  producingRunId: Schema.optional(ResearchRunId),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type ResearchArtifactManifest = typeof ResearchArtifactManifest.Type;

export const ResearchRunManifest = Schema.Struct({
  schemaVersion: ResearchStudySchemaVersion,
  id: ResearchRunId,
  command: Schema.Array(TrimmedNonEmptyString),
  cwd: StudyRelativePath,
  startedAt: IsoDateTime,
  finishedAt: IsoDateTime,
  exitCode: NonNegativeInt,
  declaredInputs: Schema.Array(ResearchCardDependency),
  declaredOutputs: Schema.Array(ResearchArtifactManifest),
});
export type ResearchRunManifest = typeof ResearchRunManifest.Type;

export const ResearchCardManifest = Schema.Struct({
  schemaVersion: ResearchStudySchemaVersion,
  id: ResearchCardId,
  card: OrchestrationResearchCard,
  dependencyIds: Schema.Array(TrimmedNonEmptyString),
  dependencies: Schema.Array(ResearchCardDependency),
  artifactIds: Schema.Array(ResearchArtifactId),
  artifacts: Schema.Array(ResearchCardArtifactReference),
  runId: Schema.optional(ResearchRunId),
  consistency: ResearchCardConsistency,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type ResearchCardManifest = typeof ResearchCardManifest.Type;

export const StudyFilePreviewInput = Schema.Struct({
  studyRoot: TrimmedNonEmptyString,
  relativePath: StudyRelativePath,
  maxBytes: Schema.optional(NonNegativeInt),
});
export type StudyFilePreviewInput = typeof StudyFilePreviewInput.Type;

export const StudyListArtifactsInput = Schema.Struct({
  studyRoot: TrimmedNonEmptyString,
});
export type StudyListArtifactsInput = typeof StudyListArtifactsInput.Type;

export const StudyArtifactInput = Schema.Struct({
  studyRoot: TrimmedNonEmptyString,
  artifactId: ResearchArtifactId,
});
export type StudyArtifactInput = typeof StudyArtifactInput.Type;

export const StudyArtifactPreviewInput = Schema.Struct({
  studyRoot: TrimmedNonEmptyString,
  artifactId: ResearchArtifactId,
  maxBytes: Schema.optional(NonNegativeInt),
});
export type StudyArtifactPreviewInput = typeof StudyArtifactPreviewInput.Type;

export const StudyStatusInput = Schema.Struct({
  studyRoot: TrimmedNonEmptyString,
});
export type StudyStatusInput = typeof StudyStatusInput.Type;

export const StudyStatusResult = Schema.Struct({
  study: ResearchStudyManifest,
  cards: Schema.Array(ResearchCardManifest),
  summary: Schema.Record(ResearchCardDependencyStatus, NonNegativeInt),
});
export type StudyStatusResult = typeof StudyStatusResult.Type;

export const StudyFilePreviewResult = Schema.Struct({
  relativePath: StudyRelativePath,
  mimeType: Schema.NullOr(TrimmedNonEmptyString),
  size: NonNegativeInt,
  contentHash: Schema.optional(ResearchContentHash),
  previewable: Schema.Boolean,
  truncated: Schema.Boolean,
  text: Schema.NullOr(Schema.String),
  reason: Schema.NullOr(Schema.Literals(["missing", "directory", "binary", "too-large"])),
});
export type StudyFilePreviewResult = typeof StudyFilePreviewResult.Type;

export const StudyArtifactFileStatus = Schema.Literals(["current", "stale", "missing"]);
export type StudyArtifactFileStatus = typeof StudyArtifactFileStatus.Type;

export const StudyArtifactRecord = Schema.Struct({
  artifact: ResearchArtifactManifest,
  relativePath: StudyRelativePath,
  status: StudyArtifactFileStatus,
  currentSize: Schema.NullOr(NonNegativeInt),
  currentMimeType: Schema.NullOr(TrimmedNonEmptyString),
  currentContentHash: Schema.NullOr(ResearchContentHash),
});
export type StudyArtifactRecord = typeof StudyArtifactRecord.Type;

export const StudyListArtifactsResult = Schema.Struct({
  artifacts: Schema.Array(StudyArtifactRecord),
});
export type StudyListArtifactsResult = typeof StudyListArtifactsResult.Type;

export const StudyGetArtifactResult = StudyArtifactRecord;
export type StudyGetArtifactResult = typeof StudyGetArtifactResult.Type;

export const StudyPreviewArtifactResult = Schema.Struct({
  artifact: StudyArtifactRecord,
  preview: StudyFilePreviewResult,
});
export type StudyPreviewArtifactResult = typeof StudyPreviewArtifactResult.Type;

export class StudyRecordError extends Schema.TaggedErrorClass<StudyRecordError>()(
  "StudyRecordError",
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {}
