import { ResearchCardDependency } from "@t3tools/contracts";
import type {
  ResearchCardDependency as ResearchCardDependencyType,
  ResearchCardManifest,
} from "@t3tools/contracts";
import { dependencyIndexPath, normalizeStudyRelativePath } from "@t3tools/shared/researchStudy";
import * as Schema from "effect/Schema";

import { writeJsonFile } from "./StudyRecordJson.ts";
import { hashStudyFile, shortHashId } from "./StudyRecordModel.ts";

const decodeCardDependency = Schema.decodeUnknownSync(ResearchCardDependency);

export async function makeDependency(
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

export async function writeMergedDependencyIndex(input: {
  readonly studyRoot: string;
  readonly manifests: ReadonlyArray<ResearchCardManifest>;
}): Promise<void> {
  const entries = input.manifests
    .flatMap((manifest) =>
      manifest.dependencies.map((dependency) => ({
        cardId: manifest.id,
        dependencyId: dependency.id,
        relativePath: dependency.relativePath,
      })),
    )
    .toSorted(
      (left, right) =>
        left.relativePath.localeCompare(right.relativePath) ||
        left.cardId.localeCompare(right.cardId) ||
        left.dependencyId.localeCompare(right.dependencyId),
    );
  await writeJsonFile(dependencyIndexPath(input.studyRoot), entries);
}
