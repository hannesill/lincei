// @effect-diagnostics nodeBuiltinImport:off
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import {
  ResearchArtifactId,
  ResearchArtifactManifest,
  ResearchCardDependency,
  ResearchCardDependencyStatus,
  ResearchCardManifest,
  ResearchContentHash,
  ResearchRunId,
  ResearchRunManifest,
  ResearchStudyId,
  ResearchStudyManifest,
  StudyArtifactRecord,
  StudyFilePreviewResult,
  type ResearchArtifactManifest as ResearchArtifactManifestType,
  type OrchestrationResearchCard,
  type ResearchCardArtifactReference,
  type ResearchCardDependency as ResearchCardDependencyType,
  type ResearchRunManifest as ResearchRunManifestType,
} from "@t3tools/contracts";
import {
  artifactManifestPath,
  cardManifestPath,
  dependencyIndexPath,
  normalizeStudyRelativePath,
  resolveStudyRecordPaths,
  resolveStudyRelativePath,
  runManifestPath,
  toStudyRelativePath,
} from "@t3tools/shared/researchStudy";
import * as Schema from "effect/Schema";

const encodeStudyManifest = Schema.encodeUnknownSync(ResearchStudyManifest);
const decodeStudyManifest = Schema.decodeUnknownSync(ResearchStudyManifest);
const encodeCardManifest = Schema.encodeUnknownSync(ResearchCardManifest);
const decodeCardManifest = Schema.decodeUnknownSync(ResearchCardManifest);
const encodeRunManifest = Schema.encodeUnknownSync(ResearchRunManifest);
const decodeRunManifest = Schema.decodeUnknownSync(ResearchRunManifest);
const encodeArtifactManifest = Schema.encodeUnknownSync(ResearchArtifactManifest);
const decodeArtifactManifest = Schema.decodeUnknownSync(ResearchArtifactManifest);
const decodeArtifactRecord = Schema.decodeUnknownSync(StudyArtifactRecord);
const decodeFilePreviewResult = Schema.decodeUnknownSync(StudyFilePreviewResult);
const decodeContentHash = Schema.decodeUnknownSync(ResearchContentHash);
const decodeRunId = Schema.decodeUnknownSync(ResearchRunId);
const decodeArtifactId = Schema.decodeUnknownSync(ResearchArtifactId);
const decodeStudyId = Schema.decodeUnknownSync(ResearchStudyId);
const decodeCardDependency = Schema.decodeUnknownSync(ResearchCardDependency);
const decodeArtifactManifestForWrite = Schema.decodeUnknownSync(ResearchArtifactManifest);
const decodeCardManifestForWrite = Schema.decodeUnknownSync(ResearchCardManifest);
const decodeRunManifestForWrite = Schema.decodeUnknownSync(ResearchRunManifest);

const DEFAULT_PREVIEW_MAX_BYTES = 1024 * 1024;
const TEXT_EXTENSIONS = new Set([
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

const DEFAULT_STUDY_GITIGNORE = [
  "artifacts/*",
  "!artifacts/.gitkeep",
  "!artifacts/*.json",
  "",
].join("\n");

function nowIso(): string {
  // @effect-diagnostics-next-line globalDate:off
  return new Date().toISOString();
}

function asContentHash(value: string): ResearchContentHash {
  return decodeContentHash(value);
}

function asRunId(value: string): ResearchRunId {
  return decodeRunId(value);
}

function asArtifactId(value: string): ResearchArtifactId {
  return decodeArtifactId(value);
}

function asStudyId(value: string): ResearchStudyId {
  return decodeStudyId(value);
}

async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function readJsonFile(filePath: string): Promise<unknown> {
  return JSON.parse(await fs.readFile(filePath, "utf8")) as unknown;
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function inferArtifactKind(relativePath: string): ResearchArtifactManifestType["kind"] {
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

function inferMimeType(relativePath: string): string | undefined {
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

function isProbablyBinary(buffer: Buffer): boolean {
  if (buffer.length === 0) return false;
  const sampleLength = Math.min(buffer.length, 4096);
  for (let index = 0; index < sampleLength; index += 1) {
    if (buffer[index] === 0) {
      return true;
    }
  }
  return false;
}

function shortHashId(prefix: string, relativePath: string): string {
  const hash = createHash("sha256").update(relativePath).digest("hex").slice(0, 16);
  return `${prefix}-${hash}`;
}

async function readManifestFiles<T>(dirPath: string, decode: (input: unknown) => T): Promise<T[]> {
  if (!(await pathExists(dirPath))) {
    return [];
  }
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const manifests: T[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) {
      continue;
    }
    manifests.push(decode(await readJsonFile(path.join(dirPath, entry.name))));
  }
  return manifests;
}

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
  readonly run: ResearchRunManifestType;
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

export async function initializeStudyRecord(
  input: StudyRecordInitInput,
): Promise<ResearchStudyManifest> {
  const paths = resolveStudyRecordPaths(input.studyRoot);
  await fs.mkdir(paths.cardsDir, { recursive: true });
  await fs.mkdir(paths.artifactsDir, { recursive: true });
  await fs.mkdir(paths.runsDir, { recursive: true });
  await fs.mkdir(paths.indexesDir, { recursive: true });
  await Promise.all([
    fs.writeFile(path.join(paths.cardsDir, ".gitkeep"), "", { flag: "a" }),
    fs.writeFile(path.join(paths.artifactsDir, ".gitkeep"), "", { flag: "a" }),
    fs.writeFile(path.join(paths.runsDir, ".gitkeep"), "", { flag: "a" }),
    fs.writeFile(path.join(paths.indexesDir, ".gitkeep"), "", { flag: "a" }),
    fs.writeFile(paths.gitignorePath, DEFAULT_STUDY_GITIGNORE, { flag: "a" }),
  ]);

  if (await pathExists(paths.studyManifestPath)) {
    return decodeStudyManifest(await readJsonFile(paths.studyManifestPath));
  }

  const timestamp = nowIso();
  const fallbackTitle = path.basename(path.resolve(input.studyRoot)) || "study";
  const manifest: ResearchStudyManifest = {
    schemaVersion: 1,
    studyId: asStudyId(`study-${randomUUID()}`),
    title: input.title?.trim() || fallbackTitle,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  await writeJsonFile(paths.studyManifestPath, encodeStudyManifest(manifest));
  return manifest;
}

export async function readStudyManifest(studyRoot: string): Promise<ResearchStudyManifest> {
  const paths = resolveStudyRecordPaths(studyRoot);
  return decodeStudyManifest(await readJsonFile(paths.studyManifestPath));
}

export async function hashStudyFile(studyRoot: string, relativePath: string): Promise<string> {
  const absolutePath = resolveStudyRelativePath(studyRoot, relativePath);
  const bytes = await fs.readFile(absolutePath);
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

async function makeDependency(
  studyRoot: string,
  relativePathInput: string,
): Promise<ResearchCardDependencyType> {
  const relativePath = normalizeStudyRelativePath(relativePathInput);
  const hash = await hashStudyFile(studyRoot, relativePath);
  return decodeCardDependency({
    id: shortHashId("dep", relativePath),
    kind: "source",
    relativePath,
    contentHash: hash,
  });
}

async function makeArtifactManifest(input: {
  readonly studyRoot: string;
  readonly relativePathInput: string;
  readonly producingRunId?: ResearchRunId;
}): Promise<ResearchArtifactManifestType> {
  const relativePath = normalizeStudyRelativePath(input.relativePathInput);
  const absolutePath = resolveStudyRelativePath(input.studyRoot, relativePath);
  const stat = await fs.stat(absolutePath);
  const timestamp = nowIso();
  return decodeArtifactManifestForWrite({
    schemaVersion: 1,
    id: shortHashId("artifact", relativePath),
    kind: inferArtifactKind(relativePath),
    relativePath,
    mimeType: inferMimeType(relativePath),
    size: stat.size,
    contentHash: await hashStudyFile(input.studyRoot, relativePath),
    producingRunId: input.producingRunId,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

async function writeArtifactManifest(
  studyRoot: string,
  artifact: ResearchArtifactManifest,
): Promise<void> {
  await writeJsonFile(
    artifactManifestPath(studyRoot, artifact.id),
    encodeArtifactManifest(artifact),
  );
}

async function readArtifactManifest(
  studyRoot: string,
  artifactId: string,
): Promise<ResearchArtifactManifest> {
  const artifact = decodeArtifactManifest(
    await readJsonFile(artifactManifestPath(studyRoot, artifactId)),
  );
  resolveStudyRelativePath(studyRoot, artifact.relativePath);
  return artifact;
}

async function tryReadArtifactManifest(
  studyRoot: string,
  artifactId: string,
): Promise<ResearchArtifactManifest | null> {
  try {
    if (!(await pathExists(artifactManifestPath(studyRoot, artifactId)))) {
      return null;
    }
    return await readArtifactManifest(studyRoot, artifactId);
  } catch {
    return null;
  }
}

export async function readCardManifests(studyRoot: string): Promise<ResearchCardManifest[]> {
  return readManifestFiles(resolveStudyRecordPaths(studyRoot).cardsDir, decodeCardManifest);
}

export async function readRunManifests(studyRoot: string): Promise<ResearchRunManifest[]> {
  return readManifestFiles(resolveStudyRecordPaths(studyRoot).runsDir, decodeRunManifest);
}

export async function readArtifactManifests(
  studyRoot: string,
): Promise<ResearchArtifactManifest[]> {
  const artifacts = await readManifestFiles(
    resolveStudyRecordPaths(studyRoot).artifactsDir,
    decodeArtifactManifest,
  );
  return artifacts.map((artifact) => {
    resolveStudyRelativePath(studyRoot, artifact.relativePath);
    return artifact;
  });
}

export async function resolveArtifactRecord(
  studyRoot: string,
  artifact: ResearchArtifactManifest,
): Promise<StudyArtifactRecord> {
  const relativePath = normalizeStudyRelativePath(artifact.relativePath);
  const absolutePath = resolveStudyRelativePath(studyRoot, relativePath);
  try {
    const stat = await fs.stat(absolutePath);
    if (stat.isDirectory()) {
      return decodeArtifactRecord({
        artifact,
        relativePath,
        status: "missing",
        currentSize: null,
        currentMimeType: null,
        currentContentHash: null,
      });
    }
    const currentContentHash = asContentHash(await hashStudyFile(studyRoot, relativePath));
    return decodeArtifactRecord({
      artifact,
      relativePath,
      status: currentContentHash === artifact.contentHash ? "current" : "stale",
      currentSize: stat.size,
      currentMimeType: inferMimeType(relativePath) ?? null,
      currentContentHash,
    });
  } catch {
    return decodeArtifactRecord({
      artifact,
      relativePath,
      status: "missing",
      currentSize: null,
      currentMimeType: null,
      currentContentHash: null,
    });
  }
}

export async function listArtifacts(
  studyRoot: string,
): Promise<{ artifacts: StudyArtifactRecord[] }> {
  await readStudyManifest(studyRoot);
  const artifacts = await Promise.all(
    (await readArtifactManifests(studyRoot)).map((artifact) =>
      resolveArtifactRecord(studyRoot, artifact),
    ),
  );
  return {
    artifacts: artifacts.toSorted((left, right) =>
      left.artifact.id.localeCompare(right.artifact.id),
    ),
  };
}

export async function getArtifact(input: {
  readonly studyRoot: string;
  readonly artifactId: string;
}): Promise<StudyArtifactRecord> {
  await readStudyManifest(input.studyRoot);
  const artifact = await readArtifactManifest(input.studyRoot, input.artifactId);
  return resolveArtifactRecord(input.studyRoot, artifact);
}

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

export async function buildCardArtifactReferences(input: {
  readonly studyRoot: string;
  readonly artifactIds?: ReadonlyArray<string>;
  readonly artifacts?: ReadonlyArray<ResearchCardArtifactReference>;
}): Promise<ResearchCardArtifactReference[]> {
  await initializeStudyRecord({ studyRoot: input.studyRoot });
  const references = new Map<string, ResearchCardArtifactReference>();
  const addManifestReference = (
    artifact: ResearchArtifactManifest,
    source?: ResearchCardArtifactReference,
  ) => {
    references.set(artifact.id, {
      ...source,
      id: artifact.id,
      kind: artifact.kind,
      path: artifact.relativePath,
      contentHash: artifact.contentHash,
      ...(artifact.mimeType ? { mimeType: artifact.mimeType } : {}),
      createdAt: artifact.createdAt,
    });
  };

  for (const artifactId of input.artifactIds ?? []) {
    addManifestReference(await readArtifactManifest(input.studyRoot, artifactId));
  }

  for (const artifact of input.artifacts ?? []) {
    if (artifact.path) {
      const manifest = await makeArtifactManifest({
        studyRoot: input.studyRoot,
        relativePathInput: artifact.path,
      });
      await writeArtifactManifest(input.studyRoot, manifest);
      addManifestReference(manifest, artifact);
      continue;
    }

    const existingManifest = await tryReadArtifactManifest(input.studyRoot, artifact.id);
    if (existingManifest) {
      addManifestReference(existingManifest, artifact);
      continue;
    }

    references.set(artifact.id, artifact);
  }

  return [...references.values()];
}

export async function computeCardConsistency(
  studyRoot: string,
  manifest: ResearchCardManifest,
): Promise<ResearchCardManifest["consistency"]> {
  const statuses: ResearchCardDependencyStatus[] = [];
  for (const dependency of manifest.dependencies) {
    if (!dependency.contentHash) {
      statuses.push("unknown");
      continue;
    }
    try {
      const currentHash = await hashStudyFile(studyRoot, dependency.relativePath);
      statuses.push(currentHash === dependency.contentHash ? "current" : "stale");
    } catch {
      statuses.push("missing");
    }
  }
  for (const artifact of manifest.artifacts) {
    if (!artifact.path || !artifact.contentHash) {
      statuses.push("unknown");
      continue;
    }
    try {
      const currentHash = await hashStudyFile(studyRoot, artifact.path);
      statuses.push(currentHash === artifact.contentHash ? "current" : "stale");
    } catch {
      statuses.push("missing");
    }
  }

  const status: ResearchCardDependencyStatus =
    statuses.length === 0
      ? "unknown"
      : statuses.includes("missing")
        ? "missing"
        : statuses.includes("stale")
          ? "stale"
          : statuses.includes("dirty-source")
            ? "dirty-source"
            : statuses.includes("unknown")
              ? "unknown"
              : "current";
  return { status, checkedAt: nowIso() };
}

export async function upsertCardManifest(
  input: UpsertCardManifestInput,
): Promise<ResearchCardManifest> {
  await initializeStudyRecord({ studyRoot: input.studyRoot });
  const dependencies = await Promise.all(
    (input.deps ?? []).map((dep) => makeDependency(input.studyRoot, dep)),
  );
  const artifactReferences: ResearchCardArtifactReference[] = [];
  artifactReferences.push(
    ...(await buildCardArtifactReferences({
      studyRoot: input.studyRoot,
      ...(input.artifactIds ? { artifactIds: input.artifactIds } : {}),
      ...(input.artifacts ? { artifacts: input.artifacts } : {}),
    })),
  );
  const card = {
    ...input.card,
    artifacts: artifactReferences,
  } satisfies OrchestrationResearchCard;
  const timestamp = nowIso();
  const runId = input.runId ? asRunId(input.runId) : undefined;
  const manifestWithoutConsistency = decodeCardManifestForWrite({
    schemaVersion: 1,
    id: card.id,
    card,
    dependencyIds: dependencies.map((dependency) => dependency.id),
    dependencies,
    artifactIds: artifactReferences.map((artifact) => asArtifactId(artifact.id)),
    artifacts: artifactReferences,
    runId,
    consistency: { status: "unknown", checkedAt: timestamp },
    createdAt: card.createdAt,
    updatedAt: timestamp,
  });
  const consistency = await computeCardConsistency(input.studyRoot, manifestWithoutConsistency);
  const manifest = { ...manifestWithoutConsistency, consistency };
  await writeJsonFile(cardManifestPath(input.studyRoot, card.id), encodeCardManifest(manifest));
  await writeJsonFile(
    dependencyIndexPath(input.studyRoot),
    manifest.dependencies.map((dependency) => ({
      cardId: manifest.id,
      dependencyId: dependency.id,
      relativePath: dependency.relativePath,
    })),
  );
  return manifest;
}

export async function getStudyStatus(studyRoot: string): Promise<StudyStatusResult> {
  const study = await readStudyManifest(studyRoot);
  const cards: ResearchCardManifest[] = [];
  for (const card of await readCardManifests(studyRoot)) {
    cards.push({ ...card, consistency: await computeCardConsistency(studyRoot, card) });
  }
  const summary: Record<ResearchCardDependencyStatus, number> = {
    current: 0,
    stale: 0,
    missing: 0,
    "dirty-source": 0,
    unknown: 0,
  };
  for (const card of cards) {
    summary[card.consistency.status] += 1;
  }
  return { study, cards, summary };
}

export async function captureRun(input: RunCaptureInput): Promise<RunCaptureResult> {
  await initializeStudyRecord({ studyRoot: input.studyRoot });
  const cwd = input.cwd ? path.resolve(input.cwd) : path.resolve(input.studyRoot);
  const runId = asRunId(`run-${randomUUID()}`);
  const startedAt = nowIso();
  const exitCode = await new Promise<number>((resolve, reject) => {
    const child = spawn(input.command[0], input.command.slice(1), {
      cwd,
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? 1));
  });
  const finishedAt = nowIso();
  const declaredInputs = await Promise.all(
    input.deps.map((dep) => makeDependency(input.studyRoot, dep)),
  );
  const declaredOutputs = await Promise.all(
    input.outs.map((out) =>
      makeArtifactManifest({
        studyRoot: input.studyRoot,
        relativePathInput: out,
        producingRunId: runId,
      }),
    ),
  );
  for (const artifact of declaredOutputs) {
    await writeArtifactManifest(input.studyRoot, artifact);
  }
  const cwdRelative =
    path.resolve(cwd) === path.resolve(input.studyRoot)
      ? "."
      : toStudyRelativePath(input.studyRoot, cwd);
  const run = decodeRunManifestForWrite({
    schemaVersion: 1,
    id: runId,
    command: input.command,
    cwd: cwdRelative,
    startedAt,
    finishedAt,
    exitCode,
    declaredInputs,
    declaredOutputs,
  });
  await writeJsonFile(runManifestPath(input.studyRoot, run.id), encodeRunManifest(run));
  return { run };
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
