import { ResearchCardDependencyStatus, type ResearchCardManifest } from "@t3tools/contracts";

import { readCardManifests } from "./ResearchCardManifestRepository.ts";
import { computeCardConsistency } from "./StudyConsistencyService.ts";
import { readStudyManifest } from "./StudyManifestRepository.ts";
import type { StudyStatusResult } from "./StudyRecordTypes.ts";

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
