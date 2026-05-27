import type { MessageId, SessionId, TurnId } from "@t3tools/contracts";
import type { EnvironmentState } from "./store";
import type {
  ChatMessage,
  ProposedPlan,
  Session,
  ProviderRuntime,
  SessionShell,
  SessionTurnState,
  TurnDiffSummary,
} from "./types";

const EMPTY_MESSAGES: ChatMessage[] = [];
const EMPTY_ACTIVITIES: Session["activities"] = [];
const EMPTY_PROPOSED_PLANS: ProposedPlan[] = [];
const EMPTY_TURN_DIFF_SUMMARIES: TurnDiffSummary[] = [];
const EMPTY_MESSAGE_MAP: Record<MessageId, ChatMessage> = {};
const EMPTY_ACTIVITY_MAP: Record<string, Session["activities"][number]> = {};
const EMPTY_PROPOSED_PLAN_MAP: Record<string, ProposedPlan> = {};
const EMPTY_TURN_DIFF_MAP: Record<TurnId, TurnDiffSummary> = {};

const collectedByIdsCache = new WeakMap<readonly string[], WeakMap<object, readonly unknown[]>>();
const sessionCache = new WeakMap<
  SessionShell,
  {
    providerRuntime: ProviderRuntime | null;
    turnState: SessionTurnState | undefined;
    messages: Session["messages"];
    activities: Session["activities"];
    proposedPlans: Session["proposedPlans"];
    turnDiffSummaries: Session["turnDiffSummaries"];
    session: Session;
  }
>();

function collectByIds<TKey extends string, TValue>(
  ids: readonly TKey[] | undefined,
  byId: Record<TKey, TValue> | undefined,
  emptyValue: TValue[],
): TValue[] {
  if (!ids || ids.length === 0 || !byId) {
    return emptyValue;
  }

  const cachedByRecord = collectedByIdsCache.get(ids);
  const cached = cachedByRecord?.get(byId);
  if (cached) {
    return cached as TValue[];
  }

  const nextValues = ids.flatMap((id) => {
    const value = byId[id];
    return value ? [value] : [];
  });
  const nextCachedByRecord = cachedByRecord ?? new WeakMap<object, readonly unknown[]>();
  nextCachedByRecord.set(byId, nextValues);
  if (!cachedByRecord) {
    collectedByIdsCache.set(ids, nextCachedByRecord);
  }
  return nextValues;
}

function selectSessionMessages(state: EnvironmentState, sessionId: SessionId): Session["messages"] {
  return collectByIds(
    state.messageIdsBySessionId[sessionId],
    state.messageBySessionId[sessionId] ?? EMPTY_MESSAGE_MAP,
    EMPTY_MESSAGES,
  );
}

function selectSessionActivities(
  state: EnvironmentState,
  sessionId: SessionId,
): Session["activities"] {
  return collectByIds(
    state.activityIdsBySessionId[sessionId],
    state.activityBySessionId[sessionId] ?? EMPTY_ACTIVITY_MAP,
    EMPTY_ACTIVITIES,
  );
}

function selectSessionProposedPlans(
  state: EnvironmentState,
  sessionId: SessionId,
): Session["proposedPlans"] {
  return collectByIds(
    state.proposedPlanIdsBySessionId[sessionId],
    state.proposedPlanBySessionId[sessionId] ?? EMPTY_PROPOSED_PLAN_MAP,
    EMPTY_PROPOSED_PLANS,
  );
}

function selectSessionTurnDiffSummaries(
  state: EnvironmentState,
  sessionId: SessionId,
): Session["turnDiffSummaries"] {
  return collectByIds(
    state.turnDiffIdsBySessionId[sessionId],
    state.turnDiffSummaryBySessionId[sessionId] ?? EMPTY_TURN_DIFF_MAP,
    EMPTY_TURN_DIFF_SUMMARIES,
  );
}

export function getSessionFromEnvironmentState(
  state: EnvironmentState,
  sessionId: SessionId,
): Session | undefined {
  const shell = state.sessionShellById[sessionId];
  if (!shell) {
    return undefined;
  }

  const providerRuntime = state.providerRuntimeById[sessionId] ?? null;
  const turnState = state.sessionTurnStateById[sessionId];
  const messages = selectSessionMessages(state, sessionId);
  const activities = selectSessionActivities(state, sessionId);
  const proposedPlans = selectSessionProposedPlans(state, sessionId);
  const turnDiffSummaries = selectSessionTurnDiffSummaries(state, sessionId);
  const cached = sessionCache.get(shell);

  if (
    cached &&
    cached.providerRuntime === providerRuntime &&
    cached.turnState === turnState &&
    cached.messages === messages &&
    cached.activities === activities &&
    cached.proposedPlans === proposedPlans &&
    cached.turnDiffSummaries === turnDiffSummaries
  ) {
    return cached.session;
  }

  const session: Session = {
    ...shell,
    session: providerRuntime,
    latestTurn: turnState?.latestTurn ?? null,
    pendingSourceProposedPlan: turnState?.pendingSourceProposedPlan,
    messages,
    activities,
    proposedPlans,
    turnDiffSummaries,
  };

  sessionCache.set(shell, {
    providerRuntime,
    turnState,
    messages,
    activities,
    proposedPlans,
    turnDiffSummaries,
    session,
  });

  return session;
}
