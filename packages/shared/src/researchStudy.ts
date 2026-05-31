// @effect-diagnostics nodeBuiltinImport:off
import path from "node:path";

import { isWindowsAbsolutePath } from "./path.ts";

export const LINCEI_STUDY_DIR = ".lincei";
export const STUDY_MANIFEST_FILE = "study.json";
export const STUDY_CARDS_DIR = "cards";
export const STUDY_ARTIFACTS_DIR = "artifacts";
export const STUDY_RUNS_DIR = "runs";
export const STUDY_INDEXES_DIR = "indexes";

export interface StudyRecordPaths {
  readonly studyRoot: string;
  readonly linceiDir: string;
  readonly studyManifestPath: string;
  readonly cardsDir: string;
  readonly artifactsDir: string;
  readonly runsDir: string;
  readonly indexesDir: string;
  readonly gitignorePath: string;
}

function assertPortableId(id: string, label: string): string {
  const trimmed = id.trim();
  if (trimmed.length === 0 || trimmed.includes("/") || trimmed.includes("\\") || trimmed === ".") {
    throw new Error(`${label} must be a non-empty portable identifier.`);
  }
  if (trimmed === "..") {
    throw new Error(`${label} must not traverse directories.`);
  }
  return trimmed;
}

export function resolveStudyRecordPaths(studyRoot: string): StudyRecordPaths {
  const linceiDir = path.resolve(studyRoot, LINCEI_STUDY_DIR);
  return {
    studyRoot: path.resolve(studyRoot),
    linceiDir,
    studyManifestPath: path.join(linceiDir, STUDY_MANIFEST_FILE),
    cardsDir: path.join(linceiDir, STUDY_CARDS_DIR),
    artifactsDir: path.join(linceiDir, STUDY_ARTIFACTS_DIR),
    runsDir: path.join(linceiDir, STUDY_RUNS_DIR),
    indexesDir: path.join(linceiDir, STUDY_INDEXES_DIR),
    gitignorePath: path.join(linceiDir, ".gitignore"),
  };
}

export function normalizeStudyRelativePath(input: string): string {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    throw new Error("Study-relative path cannot be empty.");
  }
  if (path.isAbsolute(trimmed) || isWindowsAbsolutePath(trimmed)) {
    throw new Error("Study-relative path cannot be absolute.");
  }

  const withPosixSeparators = trimmed.replaceAll("\\", "/");
  const normalized = path.posix.normalize(withPosixSeparators);
  if (normalized === "." || normalized === ".." || normalized.startsWith("../")) {
    throw new Error("Study-relative path must stay within the study root.");
  }
  return normalized.replace(/^.\//, "");
}

export function resolveStudyRelativePath(studyRoot: string, relativePath: string): string {
  const normalizedRelativePath = normalizeStudyRelativePath(relativePath);
  const root = path.resolve(studyRoot);
  const resolved = path.resolve(root, normalizedRelativePath);
  const relativeFromRoot = path.relative(root, resolved);
  if (
    relativeFromRoot === "" ||
    relativeFromRoot.startsWith("..") ||
    path.isAbsolute(relativeFromRoot)
  ) {
    throw new Error("Study-relative path must stay within the study root.");
  }
  return resolved;
}

export function toStudyRelativePath(studyRoot: string, absolutePath: string): string {
  const root = path.resolve(studyRoot);
  const resolved = path.resolve(absolutePath);
  const relative = path.relative(root, resolved);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Path must be inside the study root.");
  }
  return normalizeStudyRelativePath(relative);
}

export function cardManifestPath(studyRoot: string, cardId: string): string {
  return path.join(
    resolveStudyRecordPaths(studyRoot).cardsDir,
    `${assertPortableId(cardId, "cardId")}.json`,
  );
}

export function runManifestPath(studyRoot: string, runId: string): string {
  return path.join(
    resolveStudyRecordPaths(studyRoot).runsDir,
    `${assertPortableId(runId, "runId")}.json`,
  );
}

export function artifactManifestPath(studyRoot: string, artifactId: string): string {
  return path.join(
    resolveStudyRecordPaths(studyRoot).artifactsDir,
    `${assertPortableId(artifactId, "artifactId")}.json`,
  );
}

export function dependencyIndexPath(studyRoot: string, indexName = "dependencies"): string {
  return path.join(
    resolveStudyRecordPaths(studyRoot).indexesDir,
    `${assertPortableId(indexName, "indexName")}.json`,
  );
}
