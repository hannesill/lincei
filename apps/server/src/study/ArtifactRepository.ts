// @effect-diagnostics nodeBuiltinImport:off
import { promises as fs } from "node:fs";

import {
  ResearchArtifactManifest,
  StudyArtifactRecord,
  type ResearchArtifactManifest as ResearchArtifactManifestType,
  type ResearchCardArtifactReference,
} from "@t3tools/contracts";
import {
  artifactManifestPath,
  normalizeStudyRelativePath,
  resolveStudyRecordPaths,
  resolveStudyRelativePath,
} from "@t3tools/shared/researchStudy";
import * as Schema from "effect/Schema";

import { initializeStudyRecord, readStudyManifest } from "./StudyManifestRepository.ts";
import { pathExists, readJsonFile, readManifestFiles, writeJsonFile } from "./StudyRecordJson.ts";
import {
  asContentHash,
  hashStudyFile,
  inferArtifactKind,
  inferMimeType,
  nowIso,
  shortHashId,
} from "./StudyRecordModel.ts";

const encodeArtifactManifest = Schema.encodeUnknownSync(ResearchArtifactManifest);
const decodeArtifactManifest = Schema.decodeUnknownSync(ResearchArtifactManifest);
const decodeArtifactRecord = Schema.decodeUnknownSync(StudyArtifactRecord);
const decodeArtifactManifestForWrite = Schema.decodeUnknownSync(ResearchArtifactManifest);

export async function makeArtifactManifest(input: {
  readonly studyRoot: string;
  readonly relativePathInput: string;
  readonly producingRunId?: ResearchArtifactManifestType["producingRunId"];
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

export async function writeArtifactManifest(
  studyRoot: string,
  artifact: ResearchArtifactManifest,
): Promise<void> {
  await writeJsonFile(
    artifactManifestPath(studyRoot, artifact.id),
    encodeArtifactManifest(artifact),
  );
}

export async function readArtifactManifest(
  studyRoot: string,
  artifactId: string,
): Promise<ResearchArtifactManifest> {
  const artifact = decodeArtifactManifest(
    await readJsonFile(artifactManifestPath(studyRoot, artifactId)),
  );
  resolveStudyRelativePath(studyRoot, artifact.relativePath);
  return artifact;
}

export async function tryReadArtifactManifest(
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
