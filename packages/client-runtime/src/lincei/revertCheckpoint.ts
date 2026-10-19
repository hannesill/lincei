import type { OrchestrationV2ThreadProjection } from "@t3tools/contracts";

/**
 * Rewinding to `turnCount` undoes every run after that ordinal. Rolled-back runs keep their
 * ordinals and new runs number after them, so the run before a resent message can sit below
 * `turnCount`: the target is the latest run at or below it that was not rolled back.
 */
export function findRevertCheckpoint(
  projection: Pick<OrchestrationV2ThreadProjection, "runs" | "checkpoints">,
  turnCount: number | undefined,
) {
  if (turnCount === undefined) return undefined;
  const targetOrdinal = projection.runs.reduce(
    (latest, run) =>
      run.status !== "rolled_back" && run.ordinal <= turnCount && run.ordinal > latest
        ? run.ordinal
        : latest,
    0,
  );
  return projection.checkpoints.findLast((candidate) =>
    targetOrdinal === 0
      ? candidate.ordinalWithinScope === 0 && candidate.appRunOrdinal === null
      : candidate.appRunOrdinal === targetOrdinal,
  );
}
