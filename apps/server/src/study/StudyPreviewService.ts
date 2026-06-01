// @effect-diagnostics nodeBuiltinImport:off
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import { StudyFilePreviewResult } from "@t3tools/contracts";
import {
  normalizeStudyRelativePath,
  resolveStudyRelativePath,
} from "@t3tools/shared/researchStudy";
import * as Schema from "effect/Schema";

import { getArtifact } from "./ArtifactRepository.ts";
import {
  asContentHash,
  DEFAULT_PREVIEW_MAX_BYTES,
  hashStudyFile,
  inferMimeType,
  isProbablyBinary,
  TEXT_EXTENSIONS,
} from "./StudyRecordModel.ts";
import type { StudyPreviewArtifactResult } from "./StudyRecordTypes.ts";

const decodeFilePreviewResult = Schema.decodeUnknownSync(StudyFilePreviewResult);

export async function previewArtifact(input: {
  readonly studyRoot: string;
  readonly artifactId: string;
  readonly maxBytes?: number | undefined;
}): Promise<StudyPreviewArtifactResult> {
  const artifact = await getArtifact(input);
  return {
    artifact,
    preview: await previewStudyFile({
      studyRoot: input.studyRoot,
      relativePath: artifact.relativePath,
      maxBytes: input.maxBytes,
    }),
  };
}

export async function previewStudyFile(input: {
  readonly studyRoot: string;
  readonly relativePath: string;
  readonly maxBytes?: number | undefined;
}): Promise<StudyFilePreviewResult> {
  const relativePath = normalizeStudyRelativePath(input.relativePath);
  const absolutePath = resolveStudyRelativePath(input.studyRoot, relativePath);
  const maxBytes = input.maxBytes ?? DEFAULT_PREVIEW_MAX_BYTES;
  try {
    const stat = await fs.stat(absolutePath);
    if (stat.isDirectory()) {
      return decodeFilePreviewResult({
        relativePath,
        mimeType: null,
        size: 0,
        previewable: false,
        truncated: false,
        text: null,
        reason: "directory",
      });
    }
    if (stat.size > maxBytes) {
      return decodeFilePreviewResult({
        relativePath,
        mimeType: inferMimeType(relativePath) ?? null,
        size: stat.size,
        contentHash: await hashStudyFile(input.studyRoot, relativePath),
        previewable: false,
        truncated: false,
        text: null,
        reason: "too-large",
      });
    }
    const bytes = await fs.readFile(absolutePath);
    const extension = path.extname(relativePath).toLowerCase();
    const binary = !TEXT_EXTENSIONS.has(extension) && isProbablyBinary(bytes);
    if (binary) {
      return decodeFilePreviewResult({
        relativePath,
        mimeType: inferMimeType(relativePath) ?? null,
        size: stat.size,
        contentHash: asContentHash(`sha256:${createHash("sha256").update(bytes).digest("hex")}`),
        previewable: false,
        truncated: false,
        text: null,
        reason: "binary",
      });
    }
    return decodeFilePreviewResult({
      relativePath,
      mimeType: inferMimeType(relativePath) ?? null,
      size: stat.size,
      contentHash: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
      previewable: true,
      truncated: false,
      text: bytes.toString("utf8"),
      reason: null,
    });
  } catch {
    return decodeFilePreviewResult({
      relativePath,
      mimeType: null,
      size: 0,
      previewable: false,
      truncated: false,
      text: null,
      reason: "missing",
    });
  }
}
