import type {
  EnvironmentId,
  MessageId,
  OrchestrationEvent,
  OrchestrationShellSnapshot,
  OrchestrationShellStreamEvent,
  OrchestrationSession,
  OrchestrationSessionActivity,
  ProjectId,
  ResearchCardLifecycleStatus,
  ScopedProjectRef,
  ScopedSessionRef,
} from "@t3tools/contracts";
import type { SessionId, TurnId } from "@t3tools/contracts";
import { attachResearchCardReviewResponse } from "@t3tools/shared/researchCards";
import { create } from "zustand";
import {
  type ChatMessage,
  type Project,
  type ProposedPlan,
  type ResearchCard,
  type SidebarSessionSummary,
  type Session,
  type ProviderRuntime,
  type SessionShell,
  type SessionTurnState,
  type TurnDiffSummary,
} from "./types";
import { sanitizeSessionErrorMessage } from "./rpc/transportError";
import { getSessionFromEnvironmentState } from "./sessionDerivation";
import {
  mapMessage,
  mapProject,
  mapProjectScripts,
  mapProposedPlan,
  mapProviderRuntime,
  mapResearchCardDetail,
  mapSession,
  mapSessionShell,
  mapTurnDiffSummary,
  normalizeModelSelection,
  providerRuntimesEqual,
  sessionShellsEqual,
  sessionTurnStatesEqual,
  sidebarSessionSummariesEqual,
  toSessionShell,
  toSessionTurnState,
} from "./store/orchestrationMapping";
export interface EnvironmentState {
  projectIds: ProjectId[];
  projectById: Record<ProjectId, Project>;

  // ---------------------------------------------------------------------------
  // Session bookkeeping — written by BOTH shell stream and detail stream.
  // Both streams ensure the session is registered here; the bookkeeping is
  // additive (append-only IDs) so concurrent writes are safe.
  // ---------------------------------------------------------------------------
  sessionIds: SessionId[];
  sessionIdsByProjectId: Record<ProjectId, SessionId[]>;

  // ---------------------------------------------------------------------------
  // Session shell / session / turn — written by BOTH shell stream and detail
  // stream.  The shell stream is the *authoritative* source (server pre-
  // computes these from the projection pipeline), but the detail stream also
  // writes them so the active session has up-to-date state even if the shell
  // event hasn't arrived yet.  Structural equality checks in both write
  // functions prevent unnecessary React re-renders when both streams deliver
  // equivalent data.
  // ---------------------------------------------------------------------------
  sessionShellById: Record<SessionId, SessionShell>;
  providerRuntimeById: Record<SessionId, ProviderRuntime | null>;
  sessionTurnStateById: Record<SessionId, SessionTurnState>;

  // ---------------------------------------------------------------------------
  // Session detail content — written ONLY by the detail stream
  // (writeSessionState / syncServerSessionDetail).  The shell stream never
  // touches these.
  // ---------------------------------------------------------------------------
  messageIdsBySessionId: Record<SessionId, MessageId[]>;
  messageBySessionId: Record<SessionId, Record<MessageId, ChatMessage>>;
  activityIdsBySessionId: Record<SessionId, string[]>;
  activityBySessionId: Record<SessionId, Record<string, OrchestrationSessionActivity>>;
  proposedPlanIdsBySessionId: Record<SessionId, string[]>;
  proposedPlanBySessionId: Record<SessionId, Record<string, ProposedPlan>>;
  researchCardIdsBySessionId: Record<SessionId, string[]>;
  researchCardBySessionId: Record<SessionId, Record<string, ResearchCard>>;
  turnDiffIdsBySessionId: Record<SessionId, TurnId[]>;
  turnDiffSummaryBySessionId: Record<SessionId, Record<TurnId, TurnDiffSummary>>;

  // ---------------------------------------------------------------------------
  // Sidebar summary — written ONLY by the shell stream
  // (writeSessionShellState / mapSessionShell).  Pre-computed server-side with
  // fields like latestUserMessageAt, hasPendingApprovals, etc.  The detail
  // stream must NOT write here; the shell stream is the single source of
  // truth for sidebar data.
  // ---------------------------------------------------------------------------
  sidebarSessionSummaryById: Record<SessionId, SidebarSessionSummary>;

  bootstrapComplete: boolean;
}

export interface AppState {
  activeEnvironmentId: EnvironmentId | null;
  environmentStateById: Record<string, EnvironmentState>;
}

const initialEnvironmentState: EnvironmentState = {
  projectIds: [],
  projectById: {},
  sessionIds: [],
  sessionIdsByProjectId: {},
  sessionShellById: {},
  providerRuntimeById: {},
  sessionTurnStateById: {},
  messageIdsBySessionId: {},
  messageBySessionId: {},
  activityIdsBySessionId: {},
  activityBySessionId: {},
  proposedPlanIdsBySessionId: {},
  proposedPlanBySessionId: {},
  researchCardIdsBySessionId: {},
  researchCardBySessionId: {},
  turnDiffIdsBySessionId: {},
  turnDiffSummaryBySessionId: {},
  sidebarSessionSummaryById: {},
  bootstrapComplete: false,
};

const initialState: AppState = {
  activeEnvironmentId: null,
  environmentStateById: {},
};

const MAX_THREAD_MESSAGES = 2_000;
const MAX_THREAD_CHECKPOINTS = 500;
const MAX_THREAD_PROPOSED_PLANS = 200;
const MAX_THREAD_ACTIVITIES = 500;
const MAX_THREAD_RESEARCH_CARDS = 200;
const EMPTY_THREAD_IDS: SessionId[] = [];

function arraysEqual<T>(left: readonly T[], right: readonly T[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function appendId<T extends string>(ids: readonly T[], id: T): T[] {
  return ids.includes(id) ? [...ids] : [...ids, id];
}

function removeId<T extends string>(ids: readonly T[], id: T): T[] {
  return ids.filter((value) => value !== id);
}

function buildMessageSlice(session: Session): {
  ids: MessageId[];
  byId: Record<MessageId, ChatMessage>;
} {
  return {
    ids: session.messages.map((message) => message.id),
    byId: Object.fromEntries(
      session.messages.map((message) => [message.id, message] as const),
    ) as Record<MessageId, ChatMessage>,
  };
}

function buildActivitySlice(session: Session): {
  ids: string[];
  byId: Record<string, OrchestrationSessionActivity>;
} {
  return {
    ids: session.activities.map((activity) => activity.id),
    byId: Object.fromEntries(
      session.activities.map((activity) => [activity.id, activity] as const),
    ) as Record<string, OrchestrationSessionActivity>,
  };
}

function buildProposedPlanSlice(session: Session): {
  ids: string[];
  byId: Record<string, ProposedPlan>;
} {
  return {
    ids: session.proposedPlans.map((plan) => plan.id),
    byId: Object.fromEntries(
      session.proposedPlans.map((plan) => [plan.id, plan] as const),
    ) as Record<string, ProposedPlan>,
  };
}

function buildResearchCardSlice(session: Session): {
  ids: string[];
  byId: Record<string, ResearchCard>;
} {
  return {
    ids: session.researchCards.map((card) => card.id),
    byId: Object.fromEntries(
      session.researchCards.map((card) => [card.id, card] as const),
    ) as Record<string, ResearchCard>,
  };
}

function buildTurnDiffSlice(session: Session): {
  ids: TurnId[];
  byId: Record<TurnId, TurnDiffSummary>;
} {
  return {
    ids: session.turnDiffSummaries.map((summary) => summary.turnId),
    byId: Object.fromEntries(
      session.turnDiffSummaries.map((summary) => [summary.turnId, summary] as const),
    ) as Record<TurnId, TurnDiffSummary>,
  };
}

function getProjects(state: EnvironmentState): Project[] {
  return state.projectIds.flatMap((projectId) => {
    const project = state.projectById[projectId];
    return project ? [project] : [];
  });
}

function getSessions(state: EnvironmentState): Session[] {
  return state.sessionIds.flatMap((sessionId) => {
    const session = getSessionFromEnvironmentState(state, sessionId);
    return session ? [session] : [];
  });
}

/**
 * Ensure a session is registered in the bookkeeping indices (sessionIds,
 * sessionIdsByProjectId).  Shared by both the shell stream and detail stream
 * write paths — the bookkeeping is additive (append-only IDs) so concurrent
 * writes from both streams are safe.
 */
function ensureSessionRegistered(
  state: EnvironmentState,
  sessionId: SessionId,
  nextProjectId: ProjectId,
  previousProjectId: ProjectId | undefined,
): EnvironmentState {
  let nextState = state;

  if (!state.sessionIds.includes(sessionId)) {
    nextState = {
      ...nextState,
      sessionIds: [...nextState.sessionIds, sessionId],
    };
  }

  if (previousProjectId !== nextProjectId) {
    let sessionIdsByProjectId = nextState.sessionIdsByProjectId;
    if (previousProjectId) {
      const previousIds = sessionIdsByProjectId[previousProjectId] ?? EMPTY_THREAD_IDS;
      const nextIds = removeId(previousIds, sessionId);
      if (nextIds.length === 0) {
        const { [previousProjectId]: _removed, ...rest } = sessionIdsByProjectId;
        sessionIdsByProjectId = rest as Record<ProjectId, SessionId[]>;
      } else if (!arraysEqual(previousIds, nextIds)) {
        sessionIdsByProjectId = {
          ...sessionIdsByProjectId,
          [previousProjectId]: nextIds,
        };
      }
    }
    const projectSessionIds = sessionIdsByProjectId[nextProjectId] ?? EMPTY_THREAD_IDS;
    const nextProjectSessionIds = appendId(projectSessionIds, sessionId);
    if (!arraysEqual(projectSessionIds, nextProjectSessionIds)) {
      sessionIdsByProjectId = {
        ...sessionIdsByProjectId,
        [nextProjectId]: nextProjectSessionIds,
      };
    }
    if (sessionIdsByProjectId !== nextState.sessionIdsByProjectId) {
      nextState = {
        ...nextState,
        sessionIdsByProjectId,
      };
    }
  }

  return nextState;
}

/**
 * Write session state from the **detail stream** (per-session subscription).
 *
 * Owns: messages, activities, proposed plans, turn diff summaries.
 * Also writes sessionShellById / providerRuntimeById / sessionTurnStateById so
 * the active session has up-to-date state even if the shell stream event
 * hasn't arrived yet (both streams use structural equality checks to avoid
 * unnecessary re-renders when delivering equivalent data).
 * Does NOT write sidebarSessionSummaryById — that is shell-stream-only.
 */
function writeSessionState(
  state: EnvironmentState,
  nextSession: Session,
  previousSession?: Session,
): EnvironmentState {
  const nextShell = toSessionShell(nextSession);
  const nextTurnState = toSessionTurnState(nextSession);
  const previousShell = state.sessionShellById[nextSession.id];
  const previousTurnState = state.sessionTurnStateById[nextSession.id];

  let nextState = ensureSessionRegistered(
    state,
    nextSession.id,
    nextSession.projectId,
    previousSession?.projectId,
  );

  if (!sessionShellsEqual(previousShell, nextShell)) {
    nextState = {
      ...nextState,
      sessionShellById: {
        ...nextState.sessionShellById,
        [nextSession.id]: nextShell,
      },
    };
  }

  if (!providerRuntimesEqual(previousSession?.session ?? null, nextSession.session)) {
    nextState = {
      ...nextState,
      providerRuntimeById: {
        ...nextState.providerRuntimeById,
        [nextSession.id]: nextSession.session,
      },
    };
  }

  if (!sessionTurnStatesEqual(previousTurnState, nextTurnState)) {
    nextState = {
      ...nextState,
      sessionTurnStateById: {
        ...nextState.sessionTurnStateById,
        [nextSession.id]: nextTurnState,
      },
    };
  }

  if (previousSession?.messages !== nextSession.messages) {
    const nextMessageSlice = buildMessageSlice(nextSession);
    nextState = {
      ...nextState,
      messageIdsBySessionId: {
        ...nextState.messageIdsBySessionId,
        [nextSession.id]: nextMessageSlice.ids,
      },
      messageBySessionId: {
        ...nextState.messageBySessionId,
        [nextSession.id]: nextMessageSlice.byId,
      },
    };
  }

  if (previousSession?.activities !== nextSession.activities) {
    const nextActivitySlice = buildActivitySlice(nextSession);
    nextState = {
      ...nextState,
      activityIdsBySessionId: {
        ...nextState.activityIdsBySessionId,
        [nextSession.id]: nextActivitySlice.ids,
      },
      activityBySessionId: {
        ...nextState.activityBySessionId,
        [nextSession.id]: nextActivitySlice.byId,
      },
    };
  }

  if (previousSession?.proposedPlans !== nextSession.proposedPlans) {
    const nextProposedPlanSlice = buildProposedPlanSlice(nextSession);
    nextState = {
      ...nextState,
      proposedPlanIdsBySessionId: {
        ...nextState.proposedPlanIdsBySessionId,
        [nextSession.id]: nextProposedPlanSlice.ids,
      },
      proposedPlanBySessionId: {
        ...nextState.proposedPlanBySessionId,
        [nextSession.id]: nextProposedPlanSlice.byId,
      },
    };
  }

  if (previousSession?.researchCards !== nextSession.researchCards) {
    const nextResearchCardSlice = buildResearchCardSlice(nextSession);
    nextState = {
      ...nextState,
      researchCardIdsBySessionId: {
        ...nextState.researchCardIdsBySessionId,
        [nextSession.id]: nextResearchCardSlice.ids,
      },
      researchCardBySessionId: {
        ...nextState.researchCardBySessionId,
        [nextSession.id]: nextResearchCardSlice.byId,
      },
    };
  }

  if (previousSession?.turnDiffSummaries !== nextSession.turnDiffSummaries) {
    const nextTurnDiffSlice = buildTurnDiffSlice(nextSession);
    nextState = {
      ...nextState,
      turnDiffIdsBySessionId: {
        ...nextState.turnDiffIdsBySessionId,
        [nextSession.id]: nextTurnDiffSlice.ids,
      },
      turnDiffSummaryBySessionId: {
        ...nextState.turnDiffSummaryBySessionId,
        [nextSession.id]: nextTurnDiffSlice.byId,
      },
    };
  }

  return nextState;
}

/**
 * Write session state from the **shell stream** (all-sessions subscription).
 *
 * Owns: sidebarSessionSummaryById (pre-computed server-side sidebar data).
 * Also writes sessionShellById / providerRuntimeById / sessionTurnStateById as
 * the authoritative source for these fields.  The detail stream may also
 * write them for the focused session (see writeSessionState); structural
 * equality checks prevent unnecessary re-renders.
 * Does NOT write message/activity/proposedPlan/turnDiff content — that is
 * detail-stream-only.
 */
function writeSessionShellState(
  state: EnvironmentState,
  nextSession: {
    shell: SessionShell;
    session: ProviderRuntime | null;
    turnState: SessionTurnState;
    summary: SidebarSessionSummary;
  },
): EnvironmentState {
  const previousShell = state.sessionShellById[nextSession.shell.id];

  let nextState = ensureSessionRegistered(
    state,
    nextSession.shell.id,
    nextSession.shell.projectId,
    previousShell?.projectId,
  );

  if (!sessionShellsEqual(previousShell, nextSession.shell)) {
    nextState = {
      ...nextState,
      sessionShellById: {
        ...nextState.sessionShellById,
        [nextSession.shell.id]: nextSession.shell,
      },
    };
  }

  if (
    !providerRuntimesEqual(
      state.providerRuntimeById[nextSession.shell.id] ?? null,
      nextSession.session,
    )
  ) {
    nextState = {
      ...nextState,
      providerRuntimeById: {
        ...nextState.providerRuntimeById,
        [nextSession.shell.id]: nextSession.session,
      },
    };
  }

  if (
    !sessionTurnStatesEqual(state.sessionTurnStateById[nextSession.shell.id], nextSession.turnState)
  ) {
    nextState = {
      ...nextState,
      sessionTurnStateById: {
        ...nextState.sessionTurnStateById,
        [nextSession.shell.id]: nextSession.turnState,
      },
    };
  }

  if (
    !sidebarSessionSummariesEqual(
      state.sidebarSessionSummaryById[nextSession.shell.id],
      nextSession.summary,
    )
  ) {
    nextState = {
      ...nextState,
      sidebarSessionSummaryById: {
        ...nextState.sidebarSessionSummaryById,
        [nextSession.shell.id]: nextSession.summary,
      },
    };
  }

  return nextState;
}

function retainSessionScopedRecord<T>(
  record: Record<SessionId, T>,
  nextSessionIds: ReadonlySet<SessionId>,
): Record<SessionId, T> {
  return Object.fromEntries(
    Object.entries(record).flatMap(([sessionId, value]) =>
      nextSessionIds.has(sessionId as SessionId) ? [[sessionId, value] as const] : [],
    ),
  ) as Record<SessionId, T>;
}

function removeSessionState(state: EnvironmentState, sessionId: SessionId): EnvironmentState {
  const shell = state.sessionShellById[sessionId];
  if (!shell) {
    return state;
  }

  const nextSessionIds = removeId(state.sessionIds, sessionId);
  const currentProjectSessionIds = state.sessionIdsByProjectId[shell.projectId] ?? EMPTY_THREAD_IDS;
  const nextProjectSessionIds = removeId(currentProjectSessionIds, sessionId);
  const nextSessionIdsByProjectId =
    nextProjectSessionIds.length === 0
      ? (() => {
          const { [shell.projectId]: _removed, ...rest } = state.sessionIdsByProjectId;
          return rest as Record<ProjectId, SessionId[]>;
        })()
      : {
          ...state.sessionIdsByProjectId,
          [shell.projectId]: nextProjectSessionIds,
        };

  const { [sessionId]: _removedShell, ...sessionShellById } = state.sessionShellById;
  const { [sessionId]: _removedSession, ...providerRuntimeById } = state.providerRuntimeById;
  const { [sessionId]: _removedTurnState, ...sessionTurnStateById } = state.sessionTurnStateById;
  const { [sessionId]: _removedMessageIds, ...messageIdsBySessionId } = state.messageIdsBySessionId;
  const { [sessionId]: _removedMessages, ...messageBySessionId } = state.messageBySessionId;
  const { [sessionId]: _removedActivityIds, ...activityIdsBySessionId } =
    state.activityIdsBySessionId;
  const { [sessionId]: _removedActivities, ...activityBySessionId } = state.activityBySessionId;
  const { [sessionId]: _removedPlanIds, ...proposedPlanIdsBySessionId } =
    state.proposedPlanIdsBySessionId;
  const { [sessionId]: _removedPlans, ...proposedPlanBySessionId } = state.proposedPlanBySessionId;
  const { [sessionId]: _removedResearchCardIds, ...researchCardIdsBySessionId } =
    state.researchCardIdsBySessionId;
  const { [sessionId]: _removedResearchCards, ...researchCardBySessionId } =
    state.researchCardBySessionId;
  const { [sessionId]: _removedTurnDiffIds, ...turnDiffIdsBySessionId } =
    state.turnDiffIdsBySessionId;
  const { [sessionId]: _removedTurnDiffs, ...turnDiffSummaryBySessionId } =
    state.turnDiffSummaryBySessionId;
  const { [sessionId]: _removedSidebarSummary, ...sidebarSessionSummaryById } =
    state.sidebarSessionSummaryById;

  return {
    ...state,
    sessionIds: nextSessionIds,
    sessionIdsByProjectId: nextSessionIdsByProjectId,
    sessionShellById,
    providerRuntimeById,
    sessionTurnStateById,
    messageIdsBySessionId,
    messageBySessionId,
    activityIdsBySessionId,
    activityBySessionId,
    proposedPlanIdsBySessionId,
    proposedPlanBySessionId,
    researchCardIdsBySessionId,
    researchCardBySessionId,
    turnDiffIdsBySessionId,
    turnDiffSummaryBySessionId,
    sidebarSessionSummaryById,
  };
}

function checkpointStatusToLatestTurnState(status: "ready" | "missing" | "error") {
  if (status === "error") {
    return "error" as const;
  }
  if (status === "missing") {
    return "interrupted" as const;
  }
  return "completed" as const;
}

function compareActivities(
  left: Session["activities"][number],
  right: Session["activities"][number],
): number {
  if (left.sequence !== undefined && right.sequence !== undefined) {
    if (left.sequence !== right.sequence) {
      return left.sequence - right.sequence;
    }
  } else if (left.sequence !== undefined) {
    return 1;
  } else if (right.sequence !== undefined) {
    return -1;
  }

  return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
}

function reviewActionToResearchCardStatus(
  action: string,
  currentStatus: ResearchCardLifecycleStatus,
): ResearchCardLifecycleStatus {
  switch (action) {
    case "accept":
    case "accepted":
      return "accepted";
    case "requestChanges":
    case "request_changes":
    case "changes-requested":
      return "changes-requested";
    case "reject":
    case "rejected":
      return "rejected";
    case "dismiss":
    case "dismissed":
      return "dismissed";
    default:
      return currentStatus;
  }
}

function buildLatestTurn(params: {
  previous: Session["latestTurn"];
  turnId: NonNullable<Session["latestTurn"]>["turnId"];
  state: NonNullable<Session["latestTurn"]>["state"];
  requestedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  assistantMessageId: NonNullable<Session["latestTurn"]>["assistantMessageId"];
  sourceProposedPlan?: Session["pendingSourceProposedPlan"];
}): NonNullable<Session["latestTurn"]> {
  const resolvedPlan =
    params.previous?.turnId === params.turnId
      ? params.previous.sourceProposedPlan
      : params.sourceProposedPlan;
  return {
    turnId: params.turnId,
    state: params.state,
    requestedAt: params.requestedAt,
    startedAt: params.startedAt,
    completedAt: params.completedAt,
    assistantMessageId: params.assistantMessageId,
    ...(resolvedPlan ? { sourceProposedPlan: resolvedPlan } : {}),
  };
}

function rebindTurnDiffSummariesForAssistantMessage(
  turnDiffSummaries: ReadonlyArray<TurnDiffSummary>,
  turnId: TurnId,
  assistantMessageId: NonNullable<Session["latestTurn"]>["assistantMessageId"],
): TurnDiffSummary[] {
  let changed = false;
  const nextSummaries = turnDiffSummaries.map((summary) => {
    if (summary.turnId !== turnId || summary.assistantMessageId === assistantMessageId) {
      return summary;
    }
    changed = true;
    return {
      ...summary,
      assistantMessageId: assistantMessageId ?? undefined,
    };
  });
  return changed ? nextSummaries : [...turnDiffSummaries];
}

function retainSessionMessagesAfterRevert(
  messages: ReadonlyArray<ChatMessage>,
  retainedTurnIds: ReadonlySet<string>,
  turnCount: number,
): ChatMessage[] {
  const retainedMessageIds = new Set<string>();
  for (const message of messages) {
    if (message.role === "system") {
      retainedMessageIds.add(message.id);
      continue;
    }
    if (
      message.turnId !== undefined &&
      message.turnId !== null &&
      retainedTurnIds.has(message.turnId)
    ) {
      retainedMessageIds.add(message.id);
    }
  }

  const retainedUserCount = messages.filter(
    (message) => message.role === "user" && retainedMessageIds.has(message.id),
  ).length;
  const missingUserCount = Math.max(0, turnCount - retainedUserCount);
  if (missingUserCount > 0) {
    const fallbackUserMessages = messages
      .filter(
        (message) =>
          message.role === "user" &&
          !retainedMessageIds.has(message.id) &&
          (message.turnId === undefined ||
            message.turnId === null ||
            retainedTurnIds.has(message.turnId)),
      )
      .toSorted(
        (left, right) =>
          left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
      )
      .slice(0, missingUserCount);
    for (const message of fallbackUserMessages) {
      retainedMessageIds.add(message.id);
    }
  }

  const retainedAssistantCount = messages.filter(
    (message) => message.role === "assistant" && retainedMessageIds.has(message.id),
  ).length;
  const missingAssistantCount = Math.max(0, turnCount - retainedAssistantCount);
  if (missingAssistantCount > 0) {
    const fallbackAssistantMessages = messages
      .filter(
        (message) =>
          message.role === "assistant" &&
          !retainedMessageIds.has(message.id) &&
          (message.turnId === undefined ||
            message.turnId === null ||
            retainedTurnIds.has(message.turnId)),
      )
      .toSorted(
        (left, right) =>
          left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
      )
      .slice(0, missingAssistantCount);
    for (const message of fallbackAssistantMessages) {
      retainedMessageIds.add(message.id);
    }
  }

  return messages.filter((message) => retainedMessageIds.has(message.id));
}

function retainSessionActivitiesAfterRevert(
  activities: ReadonlyArray<OrchestrationSessionActivity>,
  retainedTurnIds: ReadonlySet<string>,
): OrchestrationSessionActivity[] {
  return activities.filter(
    (activity) => activity.turnId === null || retainedTurnIds.has(activity.turnId),
  );
}

function retainSessionProposedPlansAfterRevert(
  proposedPlans: ReadonlyArray<ProposedPlan>,
  retainedTurnIds: ReadonlySet<string>,
): ProposedPlan[] {
  return proposedPlans.filter(
    (proposedPlan) => proposedPlan.turnId === null || retainedTurnIds.has(proposedPlan.turnId),
  );
}

function retainSessionResearchCardsAfterRevert(
  researchCards: ReadonlyArray<ResearchCard>,
  retainedTurnIds: ReadonlySet<string>,
): ResearchCard[] {
  return researchCards.filter(
    (researchCard) => researchCard.turnId === null || retainedTurnIds.has(researchCard.turnId),
  );
}

function updateSessionState(
  state: EnvironmentState,
  sessionId: SessionId,
  updater: (session: Session) => Session,
): EnvironmentState {
  const currentSession = getSessionFromEnvironmentState(state, sessionId);
  if (!currentSession) {
    return state;
  }
  const nextSession = updater(currentSession);
  if (nextSession === currentSession) {
    return state;
  }
  return writeSessionState(state, nextSession, currentSession);
}

function buildProjectState(
  projects: ReadonlyArray<Project>,
): Pick<EnvironmentState, "projectIds" | "projectById"> {
  return {
    projectIds: projects.map((project) => project.id),
    projectById: Object.fromEntries(
      projects.map((project) => [project.id, project] as const),
    ) as Record<ProjectId, Project>,
  };
}

function getStoredEnvironmentState(
  state: AppState,
  environmentId: EnvironmentId,
): EnvironmentState {
  return state.environmentStateById[environmentId] ?? initialEnvironmentState;
}

function commitEnvironmentState(
  state: AppState,
  environmentId: EnvironmentId,
  nextEnvironmentState: EnvironmentState,
): AppState {
  const currentEnvironmentState = state.environmentStateById[environmentId];
  const environmentStateById =
    currentEnvironmentState === nextEnvironmentState
      ? state.environmentStateById
      : {
          ...state.environmentStateById,
          [environmentId]: nextEnvironmentState,
        };

  if (environmentStateById === state.environmentStateById) {
    return state;
  }

  return {
    ...state,
    environmentStateById,
  };
}

function syncEnvironmentShellSnapshot(
  state: EnvironmentState,
  snapshot: OrchestrationShellSnapshot,
  environmentId: EnvironmentId,
): EnvironmentState {
  const nextProjects = snapshot.projects.map((project) => mapProject(project, environmentId));
  const nextSessionIds = new Set(snapshot.sessions.map((session) => session.id));
  let nextState: EnvironmentState = {
    ...state,
    ...buildProjectState(nextProjects),
    sessionIds: [],
    sessionIdsByProjectId: {},
    sessionShellById: {},
    providerRuntimeById: {},
    sessionTurnStateById: {},
    sidebarSessionSummaryById: {},
    messageIdsBySessionId: retainSessionScopedRecord(state.messageIdsBySessionId, nextSessionIds),
    messageBySessionId: retainSessionScopedRecord(state.messageBySessionId, nextSessionIds),
    activityIdsBySessionId: retainSessionScopedRecord(state.activityIdsBySessionId, nextSessionIds),
    activityBySessionId: retainSessionScopedRecord(state.activityBySessionId, nextSessionIds),
    proposedPlanIdsBySessionId: retainSessionScopedRecord(
      state.proposedPlanIdsBySessionId,
      nextSessionIds,
    ),
    proposedPlanBySessionId: retainSessionScopedRecord(
      state.proposedPlanBySessionId,
      nextSessionIds,
    ),
    researchCardIdsBySessionId: retainSessionScopedRecord(
      state.researchCardIdsBySessionId,
      nextSessionIds,
    ),
    researchCardBySessionId: retainSessionScopedRecord(
      state.researchCardBySessionId,
      nextSessionIds,
    ),
    turnDiffIdsBySessionId: retainSessionScopedRecord(state.turnDiffIdsBySessionId, nextSessionIds),
    turnDiffSummaryBySessionId: retainSessionScopedRecord(
      state.turnDiffSummaryBySessionId,
      nextSessionIds,
    ),
    bootstrapComplete: true,
  };

  for (const session of snapshot.sessions) {
    nextState = writeSessionShellState(nextState, mapSessionShell(session, environmentId));
  }

  return nextState;
}

export function syncServerShellSnapshot(
  state: AppState,
  snapshot: OrchestrationShellSnapshot,
  environmentId: EnvironmentId,
): AppState {
  return commitEnvironmentState(
    state,
    environmentId,
    syncEnvironmentShellSnapshot(
      getStoredEnvironmentState(state, environmentId),
      snapshot,
      environmentId,
    ),
  );
}

export function syncServerSessionDetail(
  state: AppState,
  session: OrchestrationSession,
  environmentId: EnvironmentId,
): AppState {
  const environmentState = getStoredEnvironmentState(state, environmentId);
  const previousSession = getSessionFromEnvironmentState(environmentState, session.id);
  return commitEnvironmentState(
    state,
    environmentId,
    writeSessionState(environmentState, mapSession(session, environmentId), previousSession),
  );
}

function applyEnvironmentOrchestrationEvent(
  state: EnvironmentState,
  event: OrchestrationEvent,
  environmentId: EnvironmentId,
): EnvironmentState {
  switch (event.type) {
    case "project.created": {
      const nextProject = mapProject(
        {
          id: event.payload.projectId,
          title: event.payload.title,
          workspaceRoot: event.payload.workspaceRoot,
          repositoryIdentity: event.payload.repositoryIdentity ?? null,
          defaultModelSelection: event.payload.defaultModelSelection,
          scripts: event.payload.scripts,
          createdAt: event.payload.createdAt,
          updatedAt: event.payload.updatedAt,
          deletedAt: null,
        },
        environmentId,
      );
      const existingProjectId =
        state.projectIds.find(
          (projectId) =>
            projectId === event.payload.projectId ||
            state.projectById[projectId]?.cwd === event.payload.workspaceRoot,
        ) ?? null;
      let projectById = state.projectById;
      let projectIds = state.projectIds;

      if (existingProjectId !== null && existingProjectId !== nextProject.id) {
        const { [existingProjectId]: _removedProject, ...restProjectById } = state.projectById;
        projectById = {
          ...restProjectById,
          [nextProject.id]: nextProject,
        };
        projectIds = state.projectIds.map((projectId) =>
          projectId === existingProjectId ? nextProject.id : projectId,
        );
      } else {
        projectById = {
          ...state.projectById,
          [nextProject.id]: nextProject,
        };
        projectIds =
          existingProjectId === null && !state.projectIds.includes(nextProject.id)
            ? [...state.projectIds, nextProject.id]
            : state.projectIds;
      }

      return {
        ...state,
        projectById,
        projectIds,
      };
    }

    case "project.meta-updated": {
      const project = state.projectById[event.payload.projectId];
      if (!project) {
        return state;
      }
      const nextProject: Project = {
        ...project,
        ...(event.payload.title !== undefined ? { name: event.payload.title } : {}),
        ...(event.payload.workspaceRoot !== undefined ? { cwd: event.payload.workspaceRoot } : {}),
        ...(event.payload.repositoryIdentity !== undefined
          ? { repositoryIdentity: event.payload.repositoryIdentity ?? null }
          : {}),
        ...(event.payload.defaultModelSelection !== undefined
          ? {
              defaultModelSelection: event.payload.defaultModelSelection
                ? normalizeModelSelection(event.payload.defaultModelSelection)
                : null,
            }
          : {}),
        ...(event.payload.scripts !== undefined
          ? { scripts: mapProjectScripts(event.payload.scripts) }
          : {}),
        updatedAt: event.payload.updatedAt,
      };
      return {
        ...state,
        projectById: {
          ...state.projectById,
          [event.payload.projectId]: nextProject,
        },
      };
    }

    case "project.deleted": {
      if (!state.projectById[event.payload.projectId]) {
        return state;
      }
      const { [event.payload.projectId]: _removedProject, ...projectById } = state.projectById;
      return {
        ...state,
        projectById,
        projectIds: removeId(state.projectIds, event.payload.projectId),
      };
    }

    case "session.created": {
      const previousSession = getSessionFromEnvironmentState(state, event.payload.sessionId);
      const nextSession = mapSession(
        {
          id: event.payload.sessionId,
          projectId: event.payload.projectId,
          title: event.payload.title,
          modelSelection: event.payload.modelSelection,
          runtimeMode: event.payload.runtimeMode,
          interactionMode: event.payload.interactionMode,
          branch: event.payload.branch,
          worktreePath: event.payload.worktreePath,
          latestTurn: null,
          createdAt: event.payload.createdAt,
          updatedAt: event.payload.updatedAt,
          archivedAt: null,
          deletedAt: null,
          messages: [],
          proposedPlans: [],
          researchCards: [],
          activities: [],
          checkpoints: [],
          session: null,
        },
        environmentId,
      );
      return writeSessionState(state, nextSession, previousSession);
    }

    case "session.deleted":
      return removeSessionState(state, event.payload.sessionId);

    case "session.archived":
      return updateSessionState(state, event.payload.sessionId, (session) => ({
        ...session,
        archivedAt: event.payload.archivedAt,
        updatedAt: event.payload.updatedAt,
      }));

    case "session.unarchived":
      return updateSessionState(state, event.payload.sessionId, (session) => ({
        ...session,
        archivedAt: null,
        updatedAt: event.payload.updatedAt,
      }));

    case "session.meta-updated":
      return updateSessionState(state, event.payload.sessionId, (session) => ({
        ...session,
        ...(event.payload.title !== undefined ? { title: event.payload.title } : {}),
        ...(event.payload.modelSelection !== undefined
          ? { modelSelection: normalizeModelSelection(event.payload.modelSelection) }
          : {}),
        ...(event.payload.branch !== undefined ? { branch: event.payload.branch } : {}),
        ...(event.payload.worktreePath !== undefined
          ? { worktreePath: event.payload.worktreePath }
          : {}),
        updatedAt: event.payload.updatedAt,
      }));

    case "session.runtime-mode-set":
      return updateSessionState(state, event.payload.sessionId, (session) => ({
        ...session,
        runtimeMode: event.payload.runtimeMode,
        updatedAt: event.payload.updatedAt,
      }));

    case "session.interaction-mode-set":
      return updateSessionState(state, event.payload.sessionId, (session) => ({
        ...session,
        interactionMode: event.payload.interactionMode,
        updatedAt: event.payload.updatedAt,
      }));

    case "session.turn-start-requested":
      return updateSessionState(state, event.payload.sessionId, (session) => ({
        ...session,
        ...(event.payload.modelSelection !== undefined
          ? { modelSelection: normalizeModelSelection(event.payload.modelSelection) }
          : {}),
        runtimeMode: event.payload.runtimeMode,
        interactionMode: event.payload.interactionMode,
        pendingSourceProposedPlan: event.payload.sourceProposedPlan,
        updatedAt: event.occurredAt,
      }));

    case "session.turn-interrupt-requested": {
      if (event.payload.turnId === undefined) {
        return state;
      }
      return updateSessionState(state, event.payload.sessionId, (session) => {
        const latestTurn = session.latestTurn;
        if (latestTurn === null || latestTurn.turnId !== event.payload.turnId) {
          return session;
        }
        return {
          ...session,
          latestTurn: buildLatestTurn({
            previous: latestTurn,
            turnId: event.payload.turnId,
            state: "interrupted",
            requestedAt: latestTurn.requestedAt,
            startedAt: latestTurn.startedAt ?? event.payload.createdAt,
            completedAt: latestTurn.completedAt ?? event.payload.createdAt,
            assistantMessageId: latestTurn.assistantMessageId,
          }),
          updatedAt: event.occurredAt,
        };
      });
    }

    case "session.message-sent":
      return updateSessionState(state, event.payload.sessionId, (session) => {
        const message = mapMessage(session.environmentId, {
          id: event.payload.messageId,
          role: event.payload.role,
          text: event.payload.text,
          ...(event.payload.attachments !== undefined
            ? { attachments: event.payload.attachments }
            : {}),
          turnId: event.payload.turnId,
          streaming: event.payload.streaming,
          createdAt: event.payload.createdAt,
          updatedAt: event.payload.updatedAt,
        });
        const existingMessage = session.messages.find((entry) => entry.id === message.id);
        const messages = existingMessage
          ? session.messages.map((entry) =>
              entry.id !== message.id
                ? entry
                : {
                    ...entry,
                    text: message.streaming
                      ? `${entry.text}${message.text}`
                      : message.text.length > 0
                        ? message.text
                        : entry.text,
                    streaming: message.streaming,
                    ...(message.turnId !== undefined ? { turnId: message.turnId } : {}),
                    ...(message.streaming
                      ? entry.completedAt !== undefined
                        ? { completedAt: entry.completedAt }
                        : {}
                      : message.completedAt !== undefined
                        ? { completedAt: message.completedAt }
                        : {}),
                    ...(message.attachments !== undefined
                      ? { attachments: message.attachments }
                      : {}),
                  },
            )
          : [...session.messages, message];
        const cappedMessages = messages.slice(-MAX_THREAD_MESSAGES);
        const turnDiffSummaries =
          event.payload.role === "assistant" && event.payload.turnId !== null
            ? rebindTurnDiffSummariesForAssistantMessage(
                session.turnDiffSummaries,
                event.payload.turnId,
                event.payload.messageId,
              )
            : session.turnDiffSummaries;
        const latestTurn: Session["latestTurn"] =
          event.payload.role === "assistant" &&
          event.payload.turnId !== null &&
          (session.latestTurn === null || session.latestTurn.turnId === event.payload.turnId)
            ? buildLatestTurn({
                previous: session.latestTurn,
                turnId: event.payload.turnId,
                state: event.payload.streaming
                  ? "running"
                  : session.latestTurn?.state === "interrupted"
                    ? "interrupted"
                    : session.latestTurn?.state === "error"
                      ? "error"
                      : "completed",
                requestedAt:
                  session.latestTurn?.turnId === event.payload.turnId
                    ? session.latestTurn.requestedAt
                    : event.payload.createdAt,
                startedAt:
                  session.latestTurn?.turnId === event.payload.turnId
                    ? (session.latestTurn.startedAt ?? event.payload.createdAt)
                    : event.payload.createdAt,
                sourceProposedPlan: session.pendingSourceProposedPlan,
                completedAt: event.payload.streaming
                  ? session.latestTurn?.turnId === event.payload.turnId
                    ? (session.latestTurn.completedAt ?? null)
                    : null
                  : event.payload.updatedAt,
                assistantMessageId: event.payload.messageId,
              })
            : session.latestTurn;
        return {
          ...session,
          messages: cappedMessages,
          turnDiffSummaries,
          latestTurn,
          updatedAt: event.occurredAt,
        };
      });

    case "session.session-set":
      return updateSessionState(state, event.payload.sessionId, (session) => ({
        ...session,
        session: mapProviderRuntime(event.payload.session),
        error: sanitizeSessionErrorMessage(event.payload.session.lastError),
        latestTurn:
          event.payload.session.status === "running" && event.payload.session.activeTurnId !== null
            ? buildLatestTurn({
                previous: session.latestTurn,
                turnId: event.payload.session.activeTurnId,
                state: "running",
                requestedAt:
                  session.latestTurn?.turnId === event.payload.session.activeTurnId
                    ? session.latestTurn.requestedAt
                    : event.payload.session.updatedAt,
                startedAt:
                  session.latestTurn?.turnId === event.payload.session.activeTurnId
                    ? (session.latestTurn.startedAt ?? event.payload.session.updatedAt)
                    : event.payload.session.updatedAt,
                completedAt: null,
                assistantMessageId:
                  session.latestTurn?.turnId === event.payload.session.activeTurnId
                    ? session.latestTurn.assistantMessageId
                    : null,
                sourceProposedPlan: session.pendingSourceProposedPlan,
              })
            : session.latestTurn,
        updatedAt: event.occurredAt,
      }));

    case "session.session-stop-requested":
      return updateSessionState(state, event.payload.sessionId, (session) =>
        session.session === null
          ? session
          : {
              ...session,
              session: {
                ...session.session,
                status: "closed",
                orchestrationStatus: "stopped",
                activeTurnId: undefined,
                updatedAt: event.payload.createdAt,
              },
              updatedAt: event.occurredAt,
            },
      );

    case "session.proposed-plan-upserted":
      return updateSessionState(state, event.payload.sessionId, (session) => {
        const proposedPlan = mapProposedPlan(event.payload.proposedPlan);
        const proposedPlans = [
          ...session.proposedPlans.filter((entry) => entry.id !== proposedPlan.id),
          proposedPlan,
        ]
          .toSorted(
            (left, right) =>
              left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
          )
          .slice(-MAX_THREAD_PROPOSED_PLANS);
        return {
          ...session,
          proposedPlans,
          updatedAt: event.occurredAt,
        };
      });

    case "session.research-card-proposed":
      return updateSessionState(state, event.payload.sessionId, (session) => {
        const researchCard = mapResearchCardDetail(
          event.payload.sessionId,
          event.payload.researchCard,
        );
        const researchCards = [
          ...session.researchCards.filter((entry) => entry.id !== researchCard.id),
          researchCard,
        ]
          .toSorted(
            (left, right) =>
              left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
          )
          .slice(-MAX_THREAD_RESEARCH_CARDS);
        return {
          ...session,
          researchCards,
          updatedAt: event.occurredAt,
        };
      });

    case "session.research-card-updated":
      return updateSessionState(state, event.payload.sessionId, (session) => {
        const researchCard = mapResearchCardDetail(
          event.payload.sessionId,
          event.payload.researchCard,
        );
        const researchCards = [
          ...session.researchCards.filter((entry) => entry.id !== event.payload.cardId),
          researchCard,
        ]
          .toSorted(
            (left, right) =>
              left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
          )
          .slice(-MAX_THREAD_RESEARCH_CARDS);
        return {
          ...session,
          researchCards,
          updatedAt: event.occurredAt,
        };
      });

    case "session.research-card-reviewed":
      return updateSessionState(state, event.payload.sessionId, (session) => {
        let changed = false;
        const researchCards = session.researchCards.map((researchCard) => {
          if (researchCard.id !== event.payload.cardId) {
            return researchCard;
          }
          changed = true;
          return {
            ...researchCard,
            status: reviewActionToResearchCardStatus(
              event.payload.response.action,
              researchCard.status,
            ),
            review: attachResearchCardReviewResponse(researchCard.review, {
              ...event.payload.response,
            }),
            updatedAt: event.payload.response.timestamp,
          };
        });
        if (!changed) {
          return session;
        }
        return {
          ...session,
          researchCards,
          updatedAt: event.occurredAt,
        };
      });

    case "session.research-card-lifecycle-updated":
      return updateSessionState(state, event.payload.sessionId, (session) => {
        let changed = false;
        const researchCards = session.researchCards.map((researchCard) => {
          if (researchCard.id !== event.payload.cardId) {
            return researchCard;
          }
          changed = true;
          return {
            ...researchCard,
            status: event.payload.status,
            updatedAt: event.payload.updatedAt,
          };
        });
        if (!changed) {
          return session;
        }
        return {
          ...session,
          researchCards,
          updatedAt: event.occurredAt,
        };
      });

    case "session.research-card-superseded":
      return updateSessionState(state, event.payload.sessionId, (session) => {
        const nextResearchCards: ResearchCard[] = [];
        for (const researchCard of session.researchCards) {
          if (researchCard.id === event.payload.replacementCard.id) {
            continue;
          }
          nextResearchCards.push(
            researchCard.id === event.payload.cardId
              ? {
                  ...researchCard,
                  status: "superseded",
                  updatedAt: event.payload.supersededAt,
                }
              : researchCard,
          );
        }
        const researchCards = [
          ...nextResearchCards,
          mapResearchCardDetail(event.payload.sessionId, event.payload.replacementCard),
        ]
          .toSorted(
            (left, right) =>
              left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
          )
          .slice(-MAX_THREAD_RESEARCH_CARDS);
        return {
          ...session,
          researchCards,
          updatedAt: event.occurredAt,
        };
      });

    case "session.turn-diff-completed":
      return updateSessionState(state, event.payload.sessionId, (session) => {
        const checkpoint = mapTurnDiffSummary({
          turnId: event.payload.turnId,
          checkpointTurnCount: event.payload.checkpointTurnCount,
          checkpointRef: event.payload.checkpointRef,
          status: event.payload.status,
          files: event.payload.files,
          assistantMessageId: event.payload.assistantMessageId,
          completedAt: event.payload.completedAt,
        });
        const existing = session.turnDiffSummaries.find(
          (entry) => entry.turnId === checkpoint.turnId,
        );
        if (existing && existing.status !== "missing" && checkpoint.status === "missing") {
          return session;
        }
        const turnDiffSummaries = [
          ...session.turnDiffSummaries.filter((entry) => entry.turnId !== checkpoint.turnId),
          checkpoint,
        ]
          .toSorted(
            (left, right) =>
              (left.checkpointTurnCount ?? Number.MAX_SAFE_INTEGER) -
              (right.checkpointTurnCount ?? Number.MAX_SAFE_INTEGER),
          )
          .slice(-MAX_THREAD_CHECKPOINTS);
        const latestTurn =
          session.latestTurn === null || session.latestTurn.turnId === event.payload.turnId
            ? buildLatestTurn({
                previous: session.latestTurn,
                turnId: event.payload.turnId,
                state: checkpointStatusToLatestTurnState(event.payload.status),
                requestedAt: session.latestTurn?.requestedAt ?? event.payload.completedAt,
                startedAt: session.latestTurn?.startedAt ?? event.payload.completedAt,
                completedAt: event.payload.completedAt,
                assistantMessageId: event.payload.assistantMessageId,
                sourceProposedPlan: session.pendingSourceProposedPlan,
              })
            : session.latestTurn;
        return {
          ...session,
          turnDiffSummaries,
          latestTurn,
          updatedAt: event.occurredAt,
        };
      });

    case "session.reverted":
      return updateSessionState(state, event.payload.sessionId, (session) => {
        const turnDiffSummaries = session.turnDiffSummaries
          .filter(
            (entry) =>
              entry.checkpointTurnCount !== undefined &&
              entry.checkpointTurnCount <= event.payload.turnCount,
          )
          .toSorted(
            (left, right) =>
              (left.checkpointTurnCount ?? Number.MAX_SAFE_INTEGER) -
              (right.checkpointTurnCount ?? Number.MAX_SAFE_INTEGER),
          )
          .slice(-MAX_THREAD_CHECKPOINTS);
        const retainedTurnIds = new Set(turnDiffSummaries.map((entry) => entry.turnId));
        const messages = retainSessionMessagesAfterRevert(
          session.messages,
          retainedTurnIds,
          event.payload.turnCount,
        ).slice(-MAX_THREAD_MESSAGES);
        const proposedPlans = retainSessionProposedPlansAfterRevert(
          session.proposedPlans,
          retainedTurnIds,
        ).slice(-MAX_THREAD_PROPOSED_PLANS);
        const researchCards = retainSessionResearchCardsAfterRevert(
          session.researchCards,
          retainedTurnIds,
        ).slice(-MAX_THREAD_RESEARCH_CARDS);
        const activities = retainSessionActivitiesAfterRevert(session.activities, retainedTurnIds);
        const latestCheckpoint = turnDiffSummaries.at(-1) ?? null;

        return {
          ...session,
          turnDiffSummaries,
          messages,
          proposedPlans,
          researchCards,
          activities,
          pendingSourceProposedPlan: undefined,
          latestTurn:
            latestCheckpoint === null
              ? null
              : {
                  turnId: latestCheckpoint.turnId,
                  state: checkpointStatusToLatestTurnState(
                    (latestCheckpoint.status ?? "ready") as "ready" | "missing" | "error",
                  ),
                  requestedAt: latestCheckpoint.completedAt,
                  startedAt: latestCheckpoint.completedAt,
                  completedAt: latestCheckpoint.completedAt,
                  assistantMessageId: latestCheckpoint.assistantMessageId ?? null,
                },
          updatedAt: event.occurredAt,
        };
      });

    case "session.activity-appended":
      return updateSessionState(state, event.payload.sessionId, (session) => {
        const activities = [
          ...session.activities.filter((activity) => activity.id !== event.payload.activity.id),
          { ...event.payload.activity },
        ]
          .toSorted(compareActivities)
          .slice(-MAX_THREAD_ACTIVITIES);
        return {
          ...session,
          activities,
          updatedAt: event.occurredAt,
        };
      });

    case "session.approval-response-requested":
    case "session.user-input-response-requested":
      return state;
  }

  return state;
}

function applyEnvironmentShellEvent(
  state: EnvironmentState,
  event: OrchestrationShellStreamEvent,
  environmentId: EnvironmentId,
): EnvironmentState {
  switch (event.kind) {
    case "project-upserted": {
      const nextProject = mapProject(event.project, environmentId);
      const existingProjectId =
        state.projectIds.find(
          (projectId) =>
            projectId === event.project.id ||
            state.projectById[projectId]?.cwd === event.project.workspaceRoot,
        ) ?? null;
      let projectById = state.projectById;
      let projectIds = state.projectIds;

      if (existingProjectId !== null && existingProjectId !== nextProject.id) {
        const { [existingProjectId]: _removedProject, ...restProjectById } = state.projectById;
        projectById = {
          ...restProjectById,
          [nextProject.id]: nextProject,
        };
        projectIds = state.projectIds.map((projectId) =>
          projectId === existingProjectId ? nextProject.id : projectId,
        );
      } else {
        projectById = {
          ...state.projectById,
          [nextProject.id]: nextProject,
        };
        projectIds =
          existingProjectId === null && !state.projectIds.includes(nextProject.id)
            ? [...state.projectIds, nextProject.id]
            : state.projectIds;
      }

      return {
        ...state,
        projectById,
        projectIds,
      };
    }
    case "project-removed": {
      if (!state.projectById[event.projectId]) {
        return state;
      }
      const { [event.projectId]: _removedProject, ...projectById } = state.projectById;
      return {
        ...state,
        projectById,
        projectIds: removeId(state.projectIds, event.projectId),
      };
    }
    case "session-upserted":
      return writeSessionShellState(state, mapSessionShell(event.session, environmentId));
    case "session-removed":
      return removeSessionState(state, event.sessionId);
  }
}

export function applyOrchestrationEvents(
  state: AppState,
  events: ReadonlyArray<OrchestrationEvent>,
  environmentId: EnvironmentId,
): AppState {
  if (events.length === 0) {
    return state;
  }
  const currentEnvironmentState = getStoredEnvironmentState(state, environmentId);
  const nextEnvironmentState = events.reduce(
    (nextState, event) => applyEnvironmentOrchestrationEvent(nextState, event, environmentId),
    currentEnvironmentState,
  );
  return commitEnvironmentState(state, environmentId, nextEnvironmentState);
}

function getEnvironmentEntries(
  state: AppState,
): ReadonlyArray<readonly [EnvironmentId, EnvironmentState]> {
  return Object.entries(state.environmentStateById) as unknown as ReadonlyArray<
    readonly [EnvironmentId, EnvironmentState]
  >;
}

export function selectEnvironmentState(
  state: AppState,
  environmentId: EnvironmentId | null | undefined,
): EnvironmentState {
  return environmentId ? getStoredEnvironmentState(state, environmentId) : initialEnvironmentState;
}

export function selectProjectsForEnvironment(
  state: AppState,
  environmentId: EnvironmentId | null | undefined,
): Project[] {
  return getProjects(selectEnvironmentState(state, environmentId));
}

export function selectSessionsForEnvironment(
  state: AppState,
  environmentId: EnvironmentId | null | undefined,
): Session[] {
  return getSessions(selectEnvironmentState(state, environmentId));
}

export function selectProjectsAcrossEnvironments(state: AppState): Project[] {
  return getEnvironmentEntries(state).flatMap(([, environmentState]) =>
    getProjects(environmentState),
  );
}

export function selectSessionsAcrossEnvironments(state: AppState): Session[] {
  return getEnvironmentEntries(state).flatMap(([, environmentState]) =>
    getSessions(environmentState),
  );
}

/** Like `selectSessionsAcrossEnvironments` but returns stable `SessionShell` references from the store (no derived data). */
export function selectSessionShellsAcrossEnvironments(state: AppState): SessionShell[] {
  return getEnvironmentEntries(state).flatMap(([, environmentState]) =>
    environmentState.sessionIds.flatMap((sessionId) => {
      const shell = environmentState.sessionShellById[sessionId];
      return shell ? [shell] : [];
    }),
  );
}

export function selectSidebarSessionsAcrossEnvironments(state: AppState): SidebarSessionSummary[] {
  return getEnvironmentEntries(state).flatMap(([environmentId, environmentState]) =>
    environmentState.sessionIds.flatMap((sessionId) => {
      const session = environmentState.sidebarSessionSummaryById[sessionId];
      return session && session.environmentId === environmentId ? [session] : [];
    }),
  );
}

export function selectSidebarSessionsForProjectRef(
  state: AppState,
  ref: ScopedProjectRef | null | undefined,
): SidebarSessionSummary[] {
  if (!ref) {
    return [];
  }

  const environmentState = selectEnvironmentState(state, ref.environmentId);
  const sessionIds = environmentState.sessionIdsByProjectId[ref.projectId] ?? EMPTY_THREAD_IDS;
  return sessionIds.flatMap((sessionId) => {
    const session = environmentState.sidebarSessionSummaryById[sessionId];
    return session ? [session] : [];
  });
}

export function selectSidebarSessionsForProjectRefs(
  state: AppState,
  refs: readonly ScopedProjectRef[],
): SidebarSessionSummary[] {
  if (refs.length === 0) return [];
  if (refs.length === 1) return selectSidebarSessionsForProjectRef(state, refs[0]);
  return refs.flatMap((ref) => selectSidebarSessionsForProjectRef(state, ref));
}

export function selectBootstrapCompleteForActiveEnvironment(state: AppState): boolean {
  return selectEnvironmentState(state, state.activeEnvironmentId).bootstrapComplete;
}

export function selectProjectByRef(
  state: AppState,
  ref: ScopedProjectRef | null | undefined,
): Project | undefined {
  return ref
    ? selectEnvironmentState(state, ref.environmentId).projectById[ref.projectId]
    : undefined;
}

export function selectSessionByRef(
  state: AppState,
  ref: ScopedSessionRef | null | undefined,
): Session | undefined {
  return ref
    ? getSessionFromEnvironmentState(
        selectEnvironmentState(state, ref.environmentId),
        ref.sessionId,
      )
    : undefined;
}

export function selectSessionExistsByRef(
  state: AppState,
  ref: ScopedSessionRef | null | undefined,
): boolean {
  return ref
    ? selectEnvironmentState(state, ref.environmentId).sessionShellById[ref.sessionId] !== undefined
    : false;
}

export function selectSidebarSessionSummaryByRef(
  state: AppState,
  ref: ScopedSessionRef | null | undefined,
): SidebarSessionSummary | undefined {
  return ref
    ? selectEnvironmentState(state, ref.environmentId).sidebarSessionSummaryById[ref.sessionId]
    : undefined;
}

export function selectSessionIdsByProjectRef(
  state: AppState,
  ref: ScopedProjectRef | null | undefined,
): SessionId[] {
  return ref
    ? (selectEnvironmentState(state, ref.environmentId).sessionIdsByProjectId[ref.projectId] ??
        EMPTY_THREAD_IDS)
    : EMPTY_THREAD_IDS;
}

export function setError(state: AppState, sessionId: SessionId, error: string | null): AppState {
  if (state.activeEnvironmentId === null) {
    return state;
  }

  const nextEnvironmentState = updateSessionState(
    getStoredEnvironmentState(state, state.activeEnvironmentId),
    sessionId,
    (session) => {
      if (session.error === error) return session;
      return { ...session, error };
    },
  );
  return commitEnvironmentState(state, state.activeEnvironmentId, nextEnvironmentState);
}

export function applyOrchestrationEvent(
  state: AppState,
  event: OrchestrationEvent,
  environmentId: EnvironmentId,
): AppState {
  return commitEnvironmentState(
    state,
    environmentId,
    applyEnvironmentOrchestrationEvent(
      getStoredEnvironmentState(state, environmentId),
      event,
      environmentId,
    ),
  );
}

export function applyShellEvent(
  state: AppState,
  event: OrchestrationShellStreamEvent,
  environmentId: EnvironmentId,
): AppState {
  return commitEnvironmentState(
    state,
    environmentId,
    applyEnvironmentShellEvent(
      getStoredEnvironmentState(state, environmentId),
      event,
      environmentId,
    ),
  );
}

export function setActiveEnvironmentId(state: AppState, environmentId: EnvironmentId): AppState {
  if (state.activeEnvironmentId === environmentId) {
    return state;
  }

  return {
    ...state,
    activeEnvironmentId: environmentId,
  };
}

export function removeEnvironmentState(state: AppState, environmentId: EnvironmentId): AppState {
  if (!state.environmentStateById[environmentId] && state.activeEnvironmentId !== environmentId) {
    return state;
  }

  const { [environmentId]: _removed, ...environmentStateById } = state.environmentStateById;
  return {
    ...state,
    activeEnvironmentId:
      state.activeEnvironmentId === environmentId ? null : state.activeEnvironmentId,
    environmentStateById,
  };
}

export function setSessionBranch(
  state: AppState,
  sessionRef: ScopedSessionRef,
  branch: string | null,
  worktreePath: string | null,
): AppState {
  const nextEnvironmentState = updateSessionState(
    getStoredEnvironmentState(state, sessionRef.environmentId),
    sessionRef.sessionId,
    (session) => {
      if (session.branch === branch && session.worktreePath === worktreePath) return session;
      const cwdChanged = session.worktreePath !== worktreePath;
      return {
        ...session,
        branch,
        worktreePath,
        ...(cwdChanged ? { session: null } : {}),
      };
    },
  );
  return commitEnvironmentState(state, sessionRef.environmentId, nextEnvironmentState);
}

interface AppStore extends AppState {
  setActiveEnvironmentId: (environmentId: EnvironmentId) => void;
  removeEnvironmentState: (environmentId: EnvironmentId) => void;
  syncServerShellSnapshot: (
    snapshot: OrchestrationShellSnapshot,
    environmentId: EnvironmentId,
  ) => void;
  syncServerSessionDetail: (session: OrchestrationSession, environmentId: EnvironmentId) => void;
  applyOrchestrationEvent: (event: OrchestrationEvent, environmentId: EnvironmentId) => void;
  applyOrchestrationEvents: (
    events: ReadonlyArray<OrchestrationEvent>,
    environmentId: EnvironmentId,
  ) => void;
  applyShellEvent: (event: OrchestrationShellStreamEvent, environmentId: EnvironmentId) => void;
  setError: (sessionId: SessionId, error: string | null) => void;
  setSessionBranch: (
    sessionRef: ScopedSessionRef,
    branch: string | null,
    worktreePath: string | null,
  ) => void;
}

export const useStore = create<AppStore>((set) => ({
  ...initialState,
  setActiveEnvironmentId: (environmentId) =>
    set((state) => setActiveEnvironmentId(state, environmentId)),
  removeEnvironmentState: (environmentId) =>
    set((state) => removeEnvironmentState(state, environmentId)),
  syncServerShellSnapshot: (snapshot, environmentId) =>
    set((state) => syncServerShellSnapshot(state, snapshot, environmentId)),
  syncServerSessionDetail: (session, environmentId) =>
    set((state) => syncServerSessionDetail(state, session, environmentId)),
  applyOrchestrationEvent: (event, environmentId) =>
    set((state) => applyOrchestrationEvent(state, event, environmentId)),
  applyOrchestrationEvents: (events, environmentId) =>
    set((state) => applyOrchestrationEvents(state, events, environmentId)),
  applyShellEvent: (event, environmentId) =>
    set((state) => applyShellEvent(state, event, environmentId)),
  setError: (sessionId, error) => set((state) => setError(state, sessionId, error)),
  setSessionBranch: (sessionRef, branch, worktreePath) =>
    set((state) => setSessionBranch(state, sessionRef, branch, worktreePath)),
}));
