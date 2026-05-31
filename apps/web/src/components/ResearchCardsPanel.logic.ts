import type { EnvironmentApi, ResearchCardArtifactReference } from "@t3tools/contracts";
import type { ResearchArtifactId, StudyRelativePath } from "@t3tools/contracts/researchStudy";

export interface ResearchArtifactPreviewLoadResult {
  readonly text: string | null;
  readonly message: string | null;
  readonly detail?: string;
}

function asStudyRelativePath(value: string): StudyRelativePath {
  return value as StudyRelativePath;
}

function asResearchArtifactId(value: string): ResearchArtifactId {
  return value as ResearchArtifactId;
}

function shortContentHash(hash: string | null | undefined): string {
  if (!hash) {
    return "unknown";
  }
  const value = hash.startsWith("sha256:") ? hash.slice("sha256:".length) : hash;
  return value.slice(0, 12);
}

function previewUnavailableMessage(reason: string | null): string {
  return reason === "too-large"
    ? "File is too large to preview."
    : reason === "binary"
      ? "Binary file is not previewable."
      : reason === "missing"
        ? "Referenced file is missing."
        : "File is not previewable.";
}

export async function loadResearchArtifactPreview(input: {
  readonly study: EnvironmentApi["study"];
  readonly studyRoot: string;
  readonly artifact: ResearchCardArtifactReference;
}): Promise<ResearchArtifactPreviewLoadResult> {
  try {
    const result = await input.study.previewArtifact({
      studyRoot: input.studyRoot,
      artifactId: asResearchArtifactId(input.artifact.id),
    });
    const filePreview = result.preview;
    const detail = [
      result.artifact.relativePath,
      result.artifact.status,
      `${result.artifact.currentSize ?? result.artifact.artifact.size} bytes`,
      `#${shortContentHash(result.artifact.currentContentHash ?? input.artifact.contentHash)}`,
    ].join(" · ");
    return {
      text: filePreview.previewable ? filePreview.text : null,
      message: filePreview.previewable ? null : previewUnavailableMessage(filePreview.reason),
      detail,
    };
  } catch (error) {
    if (!input.artifact.path) {
      throw error;
    }
    const result = await input.study.previewFile({
      studyRoot: input.studyRoot,
      relativePath: asStudyRelativePath(input.artifact.path),
    });
    return {
      text: result.previewable ? result.text : null,
      message: result.previewable ? null : previewUnavailableMessage(result.reason),
    };
  }
}
