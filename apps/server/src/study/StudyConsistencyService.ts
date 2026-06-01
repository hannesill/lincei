import { ResearchCardDependencyStatus, type ResearchCardManifest } from "@t3tools/contracts";

import { hashStudyFile, nowIso } from "./StudyRecordModel.ts";

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
