import type { OrchestrationEvent, SessionId } from "@t3tools/contracts";

export interface OrchestrationBatchEffects {
  promoteDraftSessionIds: SessionId[];
  clearDeletedSessionIds: SessionId[];
  removeTerminalStateSessionIds: SessionId[];
  needsProviderInvalidation: boolean;
}

export function deriveOrchestrationBatchEffects(
  events: readonly OrchestrationEvent[],
): OrchestrationBatchEffects {
  const sessionLifecycleEffects = new Map<
    SessionId,
    {
      clearPromotedDraft: boolean;
      clearDeletedSession: boolean;
      removeTerminalState: boolean;
    }
  >();
  let needsProviderInvalidation = false;

  for (const event of events) {
    switch (event.type) {
      case "session.turn-diff-completed":
      case "session.reverted": {
        needsProviderInvalidation = true;
        break;
      }

      case "session.created": {
        sessionLifecycleEffects.set(event.payload.sessionId, {
          clearPromotedDraft: true,
          clearDeletedSession: false,
          removeTerminalState: false,
        });
        break;
      }

      case "session.deleted": {
        sessionLifecycleEffects.set(event.payload.sessionId, {
          clearPromotedDraft: false,
          clearDeletedSession: true,
          removeTerminalState: true,
        });
        break;
      }

      case "session.archived": {
        sessionLifecycleEffects.set(event.payload.sessionId, {
          clearPromotedDraft: false,
          clearDeletedSession: false,
          removeTerminalState: true,
        });
        break;
      }

      case "session.unarchived": {
        sessionLifecycleEffects.set(event.payload.sessionId, {
          clearPromotedDraft: false,
          clearDeletedSession: false,
          removeTerminalState: false,
        });
        break;
      }

      default: {
        break;
      }
    }
  }

  const promoteDraftSessionIds: SessionId[] = [];
  const clearDeletedSessionIds: SessionId[] = [];
  const removeTerminalStateSessionIds: SessionId[] = [];
  for (const [sessionId, effect] of sessionLifecycleEffects) {
    if (effect.clearPromotedDraft) {
      promoteDraftSessionIds.push(sessionId);
    }
    if (effect.clearDeletedSession) {
      clearDeletedSessionIds.push(sessionId);
    }
    if (effect.removeTerminalState) {
      removeTerminalStateSessionIds.push(sessionId);
    }
  }

  return {
    promoteDraftSessionIds,
    clearDeletedSessionIds,
    removeTerminalStateSessionIds,
    needsProviderInvalidation,
  };
}
