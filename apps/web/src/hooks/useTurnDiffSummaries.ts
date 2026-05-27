import { useMemo } from "react";
import { inferCheckpointTurnCountByTurnId } from "../session-logic";
import type { Session } from "../types";

export function useTurnDiffSummaries(activeSession: Session | undefined) {
  const turnDiffSummaries = useMemo(() => {
    if (!activeSession) {
      return [];
    }
    return activeSession.turnDiffSummaries;
  }, [activeSession]);

  const inferredCheckpointTurnCountByTurnId = useMemo(
    () => inferCheckpointTurnCountByTurnId(turnDiffSummaries),
    [turnDiffSummaries],
  );

  return { turnDiffSummaries, inferredCheckpointTurnCountByTurnId };
}
