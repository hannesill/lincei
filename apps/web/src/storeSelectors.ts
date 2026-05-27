import { type ScopedProjectRef, type ScopedSessionRef, type SessionId } from "@t3tools/contracts";
import { selectEnvironmentState, type AppState, type EnvironmentState } from "./store";
import { type Project, type Session } from "./types";
import { getSessionFromEnvironmentState } from "./sessionDerivation";

export function createProjectSelectorByRef(
  ref: ScopedProjectRef | null | undefined,
): (state: AppState) => Project | undefined {
  return (state) =>
    ref ? selectEnvironmentState(state, ref.environmentId).projectById[ref.projectId] : undefined;
}

function createScopedSessionSelector(
  resolveRef: (state: AppState) => ScopedSessionRef | null | undefined,
): (state: AppState) => Session | undefined {
  let previousEnvironmentState: EnvironmentState | undefined;
  let previousSessionId: SessionId | undefined;
  let previousSession: Session | undefined;

  return (state) => {
    const ref = resolveRef(state);
    if (!ref) {
      return undefined;
    }

    const environmentState = selectEnvironmentState(state, ref.environmentId);
    if (
      previousSession &&
      previousEnvironmentState === environmentState &&
      previousSessionId === ref.sessionId
    ) {
      return previousSession;
    }

    previousEnvironmentState = environmentState;
    previousSessionId = ref.sessionId;
    previousSession = getSessionFromEnvironmentState(environmentState, ref.sessionId);
    return previousSession;
  };
}

export function createSessionSelectorByRef(
  ref: ScopedSessionRef | null | undefined,
): (state: AppState) => Session | undefined {
  return createScopedSessionSelector(() => ref);
}

export function createSessionSelectorAcrossEnvironments(
  sessionId: SessionId | null | undefined,
): (state: AppState) => Session | undefined {
  return createScopedSessionSelector((state) => {
    if (!sessionId) {
      return undefined;
    }

    for (const [environmentId, environmentState] of Object.entries(
      state.environmentStateById,
    ) as Array<[ScopedSessionRef["environmentId"], EnvironmentState]>) {
      if (environmentState.sessionShellById[sessionId]) {
        return {
          environmentId,
          sessionId,
        };
      }
    }
    return undefined;
  });
}
