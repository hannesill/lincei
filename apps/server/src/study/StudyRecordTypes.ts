import type {
  OrchestrationResearchCard,
  ResearchCardArtifactReference,
  ResearchCardDependencyStatus,
  ResearchCardManifest,
  ResearchRunManifest,
  ResearchStudyManifest,
  StudyArtifactRecord,
  StudyFilePreviewResult,
} from "@t3tools/contracts";

export interface StudyRecordInitInput {
  readonly studyRoot: string;
  readonly title?: string | undefined;
}

export interface RunCaptureInput {
  readonly studyRoot: string;
  readonly deps: ReadonlyArray<string>;
  readonly outs: ReadonlyArray<string>;
  readonly command: readonly [string, ...string[]];
  readonly cwd?: string | undefined;
}

export interface RunCaptureResult {
  readonly run: ResearchRunManifest;
}

export interface UpsertCardManifestInput {
  readonly studyRoot: string;
  readonly card: OrchestrationResearchCard;
  readonly deps?: ReadonlyArray<string>;
  readonly artifactIds?: ReadonlyArray<string>;
  readonly artifacts?: ReadonlyArray<ResearchCardArtifactReference>;
  readonly runId?: string | undefined;
}

export interface StudyStatusResult {
  readonly study: ResearchStudyManifest;
  readonly cards: ReadonlyArray<ResearchCardManifest>;
  readonly summary: Record<ResearchCardDependencyStatus, number>;
}

export interface StudyPreviewArtifactResult {
  readonly artifact: StudyArtifactRecord;
  readonly preview: StudyFilePreviewResult;
}
