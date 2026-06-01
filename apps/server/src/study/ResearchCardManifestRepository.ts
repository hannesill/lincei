import {
  ResearchArtifactId,
  ResearchCardManifest,
  type OrchestrationResearchCard,
  type ResearchCardArtifactReference,
} from "@t3tools/contracts";
import { cardManifestPath, resolveStudyRecordPaths } from "@t3tools/shared/researchStudy";
import * as Schema from "effect/Schema";

import { buildCardArtifactReferences } from "./ArtifactRepository.ts";
import { computeCardConsistency } from "./StudyConsistencyService.ts";
import { makeDependency, writeMergedDependencyIndex } from "./StudyDependencyRepository.ts";
import { initializeStudyRecord } from "./StudyManifestRepository.ts";
import { readJsonFile, readManifestFiles, writeJsonFile } from "./StudyRecordJson.ts";
import { asRunId, nowIso } from "./StudyRecordModel.ts";
import type { UpsertCardManifestInput } from "./StudyRecordTypes.ts";

const encodeCardManifest = Schema.encodeUnknownSync(ResearchCardManifest);
const decodeCardManifest = Schema.decodeUnknownSync(ResearchCardManifest);
const decodeCardManifestForWrite = Schema.decodeUnknownSync(ResearchCardManifest);
const decodeArtifactId = Schema.decodeUnknownSync(ResearchArtifactId);

export async function readCardManifest(
  studyRoot: string,
  cardId: string,
): Promise<ResearchCardManifest> {
  return decodeCardManifest(await readJsonFile(cardManifestPath(studyRoot, cardId)));
}

export async function readCardManifests(studyRoot: string): Promise<ResearchCardManifest[]> {
  return readManifestFiles(resolveStudyRecordPaths(studyRoot).cardsDir, decodeCardManifest);
}

export async function writeCardManifest(
  studyRoot: string,
  manifest: ResearchCardManifest,
): Promise<void> {
  await writeJsonFile(cardManifestPath(studyRoot, manifest.id), encodeCardManifest(manifest));
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
    artifactIds: artifactReferences.map((artifact) => decodeArtifactId(artifact.id)),
    artifacts: artifactReferences,
    runId,
    consistency: { status: "unknown", checkedAt: timestamp },
    createdAt: card.createdAt,
    updatedAt: timestamp,
  });
  const consistency = await computeCardConsistency(input.studyRoot, manifestWithoutConsistency);
  const manifest = { ...manifestWithoutConsistency, consistency };
  await writeCardManifest(input.studyRoot, manifest);
  await writeMergedDependencyIndex({
    studyRoot: input.studyRoot,
    manifests: await readCardManifests(input.studyRoot),
  });
  return manifest;
}
