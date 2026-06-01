// @effect-diagnostics nodeBuiltinImport:off
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import {
  ResearchArtifactId,
  ResearchContentHash,
  ResearchRunId,
  ResearchStudyId,
  type ResearchArtifactManifest,
} from "@t3tools/contracts";
import {
  normalizeStudyRelativePath,
  resolveStudyRelativePath,
} from "@t3tools/shared/researchStudy";
import * as Schema from "effect/Schema";

const decodeContentHash = Schema.decodeUnknownSync(ResearchContentHash);
const decodeRunId = Schema.decodeUnknownSync(ResearchRunId);
const decodeArtifactId = Schema.decodeUnknownSync(ResearchArtifactId);
const decodeStudyId = Schema.decodeUnknownSync(ResearchStudyId);

export const DEFAULT_PREVIEW_MAX_BYTES = 1024 * 1024;
export const TEXT_EXTENSIONS = new Set([
  ".c",
  ".cc",
  ".conf",
  ".cpp",
  ".css",
  ".csv",
  ".h",
  ".html",
  ".ipynb",
  ".java",
  ".js",
  ".json",
  ".jsonl",
  ".jsx",
  ".log",
  ".md",
  ".mjs",
  ".py",
  ".r",
  ".rs",
  ".sh",
  ".sql",
  ".ts",
  ".tsx",
  ".txt",
  ".xml",
  ".yaml",
  ".yml",
]);

export function nowIso(): string {
  // @effect-diagnostics-next-line globalDate:off
  return new Date().toISOString();
}

export function asContentHash(value: string): ResearchContentHash {
  return decodeContentHash(value);
}

export function asRunId(value: string): ResearchRunId {
  return decodeRunId(value);
}

export function asArtifactId(value: string): ResearchArtifactId {
  return decodeArtifactId(value);
}

export function asStudyId(value: string): ResearchStudyId {
  return decodeStudyId(value);
}

export async function hashStudyFile(studyRoot: string, relativePath: string): Promise<string> {
  const absolutePath = resolveStudyRelativePath(studyRoot, relativePath);
  const bytes = await fs.readFile(absolutePath);
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

export function inferArtifactKind(relativePath: string): ResearchArtifactManifest["kind"] {
  switch (path.extname(relativePath).toLowerCase()) {
    case ".csv":
      return "csv";
    case ".md":
      return "markdown";
    case ".parquet":
      return "parquet";
    case ".sql":
      return "sql";
    case ".png":
    case ".jpg":
    case ".jpeg":
    case ".svg":
    case ".webp":
      return "visual";
    default:
      return "other";
  }
}

export function inferMimeType(relativePath: string): string | undefined {
  switch (path.extname(relativePath).toLowerCase()) {
    case ".csv":
      return "text/csv";
    case ".html":
      return "text/html";
    case ".ipynb":
    case ".json":
      return "application/json";
    case ".jsonl":
      return "application/x-ndjson";
    case ".md":
      return "text/markdown";
    case ".parquet":
      return "application/vnd.apache.parquet";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".sql":
      return "application/sql";
    case ".svg":
      return "image/svg+xml";
    case ".ts":
    case ".tsx":
      return "text/typescript";
    default:
      return TEXT_EXTENSIONS.has(path.extname(relativePath).toLowerCase())
        ? "text/plain"
        : undefined;
  }
}

export function isProbablyBinary(buffer: Buffer): boolean {
  if (buffer.length === 0) return false;
  const sampleLength = Math.min(buffer.length, 4096);
  for (let index = 0; index < sampleLength; index += 1) {
    if (buffer[index] === 0) {
      return true;
    }
  }
  return false;
}

export function shortHashId(prefix: string, relativePathInput: string): string {
  const relativePath = normalizeStudyRelativePath(relativePathInput);
  const hash = createHash("sha256").update(relativePath).digest("hex").slice(0, 16);
  return `${prefix}-${hash}`;
}
