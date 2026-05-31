import { scopeSessionRef } from "@t3tools/client-runtime";
import {
  CheckpointRef,
  DEFAULT_MODEL,
  EnvironmentId,
  EventId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ResearchCardId,
  SessionId,
  TurnId,
  type OrchestrationEvent,
  type OrchestrationSession,
} from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import {
  applyOrchestrationEvent,
  applyOrchestrationEvents,
  removeEnvironmentState,
  selectEnvironmentState,
  selectProjectsAcrossEnvironments,
  selectSessionByRef,
  selectSessionExistsByRef,
  setSessionBranch,
  selectSessionsAcrossEnvironments,
  syncServerSessionDetail,
  type AppState,
  type EnvironmentState,
} from "./store";
import {
  DEFAULT_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  type ResearchCard,
  type Session,
} from "./types";

const localEnvironmentId = EnvironmentId.make("environment-local");
const remoteEnvironmentId = EnvironmentId.make("environment-remote");

function withActiveEnvironmentState(
  environmentState: EnvironmentState,
  overrides: Partial<AppState & EnvironmentState> = {},
): AppState {
  const {
    activeEnvironmentId: overrideActiveEnvironmentId,
    environmentStateById: overrideEnvironmentStateById,
    ...environmentOverrides
  } = overrides;
  const activeEnvironmentId = overrideActiveEnvironmentId ?? localEnvironmentId;
  const mergedEnvironmentState = {
    ...environmentState,
    ...environmentOverrides,
  };
  const environmentStateById =
    overrideEnvironmentStateById ??
    (activeEnvironmentId
      ? {
          [activeEnvironmentId]: mergedEnvironmentState,
        }
      : {});

  return {
    activeEnvironmentId,
    environmentStateById,
  };
}

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: SessionId.make("session-1"),
    environmentId: localEnvironmentId,
    codexSessionId: null,
    projectId: ProjectId.make("project-1"),
    title: "Session",
    modelSelection: {
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-5-codex",
    },
    runtimeMode: DEFAULT_RUNTIME_MODE,
    interactionMode: DEFAULT_INTERACTION_MODE,
    session: null,
    messages: [],
    turnDiffSummaries: [],
    activities: [],
    proposedPlans: [],
    researchCards: [],
    error: null,
    createdAt: "2026-02-13T00:00:00.000Z",
    archivedAt: null,
    latestTurn: null,
    branch: null,
    worktreePath: null,
    ...overrides,
  };
}

function makeResearchCard(overrides: Partial<ResearchCard> = {}): ResearchCard {
  return {
    id: ResearchCardId.make("card-1"),
    type: "markdown",
    status: "proposed",
    title: "Baseline cohort",
    preview: "Initial cohort definition.",
    artifacts: [],
    provenance: [],
    turnId: null,
    createdAt: "2026-02-13T00:00:00.000Z",
    updatedAt: "2026-02-13T00:00:01.000Z",
    ...overrides,
  };
}

function makeServerSession(overrides: Partial<OrchestrationSession> = {}): OrchestrationSession {
  return {
    id: SessionId.make("session-1"),
    projectId: ProjectId.make("project-1"),
    title: "Session",
    modelSelection: {
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-5-codex",
    },
    runtimeMode: DEFAULT_RUNTIME_MODE,
    interactionMode: DEFAULT_INTERACTION_MODE,
    branch: null,
    worktreePath: null,
    latestTurn: null,
    createdAt: "2026-02-13T00:00:00.000Z",
    updatedAt: "2026-02-13T00:00:01.000Z",
    archivedAt: null,
    deletedAt: null,
    messages: [],
    proposedPlans: [],
    researchCards: [],
    activities: [],
    checkpoints: [],
    session: null,
    ...overrides,
  };
}

function makeState(session: Session): AppState {
  const projectId = ProjectId.make("project-1");
  const project = {
    id: projectId,
    environmentId: session.environmentId,
    name: "Project",
    cwd: "/tmp/project",
    defaultModelSelection: {
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-5-codex",
    },
    createdAt: "2026-02-13T00:00:00.000Z",
    updatedAt: "2026-02-13T00:00:00.000Z",
    scripts: [],
  };
  const sessionIdsByProjectId: EnvironmentState["sessionIdsByProjectId"] = {
    [session.projectId]: [session.id],
  };
  const environmentState = {
    projectIds: [projectId],
    projectById: {
      [projectId]: project,
    },
    sessionIds: [session.id],
    sessionIdsByProjectId,
    sessionShellById: {
      [session.id]: {
        id: session.id,
        environmentId: session.environmentId,
        codexSessionId: session.codexSessionId,
        projectId: session.projectId,
        title: session.title,
        modelSelection: session.modelSelection,
        runtimeMode: session.runtimeMode,
        interactionMode: session.interactionMode,
        error: session.error,
        createdAt: session.createdAt,
        archivedAt: session.archivedAt,
        updatedAt: session.updatedAt,
        branch: session.branch,
        worktreePath: session.worktreePath,
      },
    },
    providerRuntimeById: {
      [session.id]: session.session,
    },
    sessionTurnStateById: {
      [session.id]: {
        latestTurn: session.latestTurn,
        ...(session.pendingSourceProposedPlan
          ? { pendingSourceProposedPlan: session.pendingSourceProposedPlan }
          : {}),
      },
    },
    messageIdsBySessionId: {
      [session.id]: session.messages.map((message) => message.id),
    },
    messageBySessionId: {
      [session.id]: Object.fromEntries(
        session.messages.map((message) => [message.id, message] as const),
      ) as EnvironmentState["messageBySessionId"][SessionId],
    },
    activityIdsBySessionId: {
      [session.id]: session.activities.map((activity) => activity.id),
    },
    activityBySessionId: {
      [session.id]: Object.fromEntries(
        session.activities.map((activity) => [activity.id, activity] as const),
      ) as EnvironmentState["activityBySessionId"][SessionId],
    },
    proposedPlanIdsBySessionId: {
      [session.id]: session.proposedPlans.map((plan) => plan.id),
    },
    proposedPlanBySessionId: {
      [session.id]: Object.fromEntries(
        session.proposedPlans.map((plan) => [plan.id, plan] as const),
      ) as EnvironmentState["proposedPlanBySessionId"][SessionId],
    },
    researchCardIdsBySessionId: {
      [session.id]: session.researchCards.map((card) => card.id),
    },
    researchCardBySessionId: {
      [session.id]: Object.fromEntries(
        session.researchCards.map((card) => [card.id, card] as const),
      ) as EnvironmentState["researchCardBySessionId"][SessionId],
    },
    turnDiffIdsBySessionId: {
      [session.id]: session.turnDiffSummaries.map((summary) => summary.turnId),
    },
    turnDiffSummaryBySessionId: {
      [session.id]: Object.fromEntries(
        session.turnDiffSummaries.map((summary) => [summary.turnId, summary] as const),
      ) as EnvironmentState["turnDiffSummaryBySessionId"][SessionId],
    },
    sidebarSessionSummaryById: {},
    bootstrapComplete: true,
  };
  return withActiveEnvironmentState(environmentState, {
    activeEnvironmentId: session.environmentId,
  });
}

function makeEmptyState(overrides: Partial<AppState & EnvironmentState> = {}): AppState {
  const environmentState: EnvironmentState = {
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
    bootstrapComplete: true,
  };
  return withActiveEnvironmentState(environmentState, overrides);
}

function localEnvironmentStateOf(state: AppState): EnvironmentState {
  return selectEnvironmentState(state, localEnvironmentId);
}

function environmentStateOf(state: AppState, environmentId: EnvironmentId): EnvironmentState {
  return selectEnvironmentState(state, environmentId);
}

function projectsOf(state: AppState) {
  return selectProjectsAcrossEnvironments(state);
}

function sessionsOf(state: AppState) {
  return selectSessionsAcrossEnvironments(state);
}

function makeEvent<T extends OrchestrationEvent["type"]>(
  type: T,
  payload: Extract<OrchestrationEvent, { type: T }>["payload"],
  overrides: Partial<Extract<OrchestrationEvent, { type: T }>> = {},
): Extract<OrchestrationEvent, { type: T }> {
  const sequence = overrides.sequence ?? 1;
  return {
    sequence,
    eventId: EventId.make(`event-${sequence}`),
    aggregateKind: "session",
    aggregateId:
      "sessionId" in payload
        ? payload.sessionId
        : "projectId" in payload
          ? payload.projectId
          : ProjectId.make("project-1"),
    occurredAt: "2026-02-27T00:00:00.000Z",
    commandId: null,
    causationEventId: null,
    correlationId: null,
    metadata: {},
    type,
    payload,
    ...overrides,
  } as Extract<OrchestrationEvent, { type: T }>;
}

describe("environment state removal", () => {
  it("drops local state for removed environments", () => {
    const removedSession = makeSession({
      environmentId: remoteEnvironmentId,
      id: SessionId.make("session-removed"),
    });
    const keptSession = makeSession({ id: SessionId.make("session-kept") });
    const removedState = makeState(removedSession).environmentStateById[remoteEnvironmentId]!;
    const keptState = makeState(keptSession).environmentStateById[localEnvironmentId]!;
    const state: AppState = {
      activeEnvironmentId: remoteEnvironmentId,
      environmentStateById: {
        [remoteEnvironmentId]: removedState,
        [localEnvironmentId]: keptState,
      },
    };

    const next = removeEnvironmentState(state, remoteEnvironmentId);

    expect(next.activeEnvironmentId).toBeNull();
    expect(next.environmentStateById[remoteEnvironmentId]).toBeUndefined();
    expect(next.environmentStateById[localEnvironmentId]).toBe(keptState);
  });

  it("preserves active environment when removing a different environment", () => {
    const state = makeState(makeSession());

    const next = removeEnvironmentState(state, remoteEnvironmentId);

    expect(next).toBe(state);
  });
});

describe("session selection memoization", () => {
  it("returns stable session references for repeated reads of the same state", () => {
    const session = makeSession({
      messages: [
        {
          id: MessageId.make("message-1"),
          role: "user",
          text: "hello",
          createdAt: "2026-02-13T00:01:00.000Z",
          streaming: false,
        },
      ],
      activities: [
        {
          id: EventId.make("activity-1"),
          tone: "info",
          kind: "step",
          summary: "working",
          payload: {},
          turnId: TurnId.make("turn-1"),
          createdAt: "2026-02-13T00:01:30.000Z",
        },
      ],
      proposedPlans: [
        {
          id: "plan-1",
          turnId: null,
          planMarkdown: "plan",
          implementedAt: null,
          implementationSessionId: null,
          createdAt: "2026-02-13T00:02:00.000Z",
          updatedAt: "2026-02-13T00:02:00.000Z",
        },
      ],
      turnDiffSummaries: [
        {
          turnId: TurnId.make("turn-1"),
          completedAt: "2026-02-13T00:03:00.000Z",
          files: [],
        },
      ],
    });
    const state = makeState(session);
    const ref = scopeSessionRef(session.environmentId, session.id);

    const first = selectSessionByRef(state, ref);
    const second = selectSessionByRef(state, ref);

    expect(first).toBeDefined();
    expect(second).toBe(first);
    expect(second?.messages).toBe(first?.messages);
    expect(second?.activities).toBe(first?.activities);
    expect(second?.proposedPlans).toBe(first?.proposedPlans);
    expect(second?.turnDiffSummaries).toBe(first?.turnDiffSummaries);
  });

  it("reuses the derived session when the app state wrapper changes but session data does not", () => {
    const session = makeSession({
      messages: [
        {
          id: MessageId.make("message-1"),
          role: "assistant",
          text: "done",
          createdAt: "2026-02-13T00:01:00.000Z",
          streaming: false,
        },
      ],
    });
    const state = makeState(session);
    const ref = scopeSessionRef(session.environmentId, session.id);
    const wrappedState: AppState = {
      ...state,
      environmentStateById: { ...state.environmentStateById },
    };

    const first = selectSessionByRef(state, ref);
    const second = selectSessionByRef(wrappedState, ref);

    expect(second).toBe(first);
  });

  it("updates the derived session when the underlying session data changes", () => {
    const session = makeSession();
    const ref = scopeSessionRef(session.environmentId, session.id);
    const firstState = makeState(session);
    const secondState = makeState({
      ...session,
      messages: [
        {
          id: MessageId.make("message-2"),
          role: "user",
          text: "new",
          createdAt: "2026-02-13T00:04:00.000Z",
          streaming: false,
        },
      ],
    });

    const first = selectSessionByRef(firstState, ref);
    const second = selectSessionByRef(secondState, ref);

    expect(second).not.toBe(first);
    expect(second?.messages).toHaveLength(1);
    expect(second?.messages[0]?.text).toBe("new");
  });

  it("checks session existence without materializing the full session", () => {
    const session = makeSession();
    const state = makeState(session);
    const ref = scopeSessionRef(session.environmentId, session.id);

    expect(selectSessionExistsByRef(state, ref)).toBe(true);
    expect(
      selectSessionExistsByRef(
        state,
        scopeSessionRef(session.environmentId, SessionId.make("missing")),
      ),
    ).toBe(false);
    expect(selectSessionExistsByRef(state, null)).toBe(false);
  });
});

describe("setSessionBranch", () => {
  it("updates only the scoped session environment", () => {
    const sharedSessionId = SessionId.make("session-shared");
    const localSession = makeSession({
      id: sharedSessionId,
      environmentId: localEnvironmentId,
      branch: "local-branch",
    });
    const remoteSession = makeSession({
      id: sharedSessionId,
      environmentId: remoteEnvironmentId,
      branch: "remote-branch",
    });
    const state: AppState = {
      activeEnvironmentId: localEnvironmentId,
      environmentStateById: {
        [localEnvironmentId]: environmentStateOf(makeState(localSession), localEnvironmentId),
        [remoteEnvironmentId]: environmentStateOf(makeState(remoteSession), remoteEnvironmentId),
      },
    };

    const next = setSessionBranch(
      state,
      scopeSessionRef(remoteEnvironmentId, sharedSessionId),
      "remote-next",
      "/tmp/remote-worktree",
    );

    expect(
      environmentStateOf(next, localEnvironmentId).sessionShellById[sharedSessionId]?.branch,
    ).toBe("local-branch");
    expect(
      environmentStateOf(next, remoteEnvironmentId).sessionShellById[sharedSessionId]?.branch,
    ).toBe("remote-next");
    expect(
      environmentStateOf(next, remoteEnvironmentId).sessionShellById[sharedSessionId]?.worktreePath,
    ).toBe("/tmp/remote-worktree");
  });
});

describe("incremental orchestration updates", () => {
  it("does not mark bootstrap complete for incremental events", () => {
    const state = withActiveEnvironmentState(localEnvironmentStateOf(makeState(makeSession())), {
      bootstrapComplete: false,
    });

    const next = applyOrchestrationEvent(
      state,
      makeEvent("session.meta-updated", {
        sessionId: SessionId.make("session-1"),
        title: "Updated title",
        updatedAt: "2026-02-27T00:00:01.000Z",
      }),
      localEnvironmentId,
    );

    expect(localEnvironmentStateOf(next).bootstrapComplete).toBe(false);
  });

  it("preserves state identity for no-op project and session deletes", () => {
    const session = makeSession();
    const state = makeState(session);

    const nextAfterProjectDelete = applyOrchestrationEvent(
      state,
      makeEvent("project.deleted", {
        projectId: ProjectId.make("project-missing"),
        deletedAt: "2026-02-27T00:00:01.000Z",
      }),
      localEnvironmentId,
    );
    const nextAfterSessionDelete = applyOrchestrationEvent(
      state,
      makeEvent("session.deleted", {
        sessionId: SessionId.make("session-missing"),
        deletedAt: "2026-02-27T00:00:01.000Z",
      }),
      localEnvironmentId,
    );

    expect(nextAfterProjectDelete).toBe(state);
    expect(nextAfterSessionDelete).toBe(state);
  });

  it("reuses an existing project row when project.created arrives with a new id for the same cwd", () => {
    const originalProjectId = ProjectId.make("project-1");
    const recreatedProjectId = ProjectId.make("project-2");
    const state: AppState = makeEmptyState({
      projectIds: [originalProjectId],
      projectById: {
        [originalProjectId]: {
          id: originalProjectId,
          environmentId: localEnvironmentId,
          name: "Project",
          cwd: "/tmp/project",
          defaultModelSelection: {
            instanceId: ProviderInstanceId.make("codex"),
            model: DEFAULT_MODEL,
          },
          createdAt: "2026-02-27T00:00:00.000Z",
          updatedAt: "2026-02-27T00:00:00.000Z",
          scripts: [],
        },
      },
    });

    const next = applyOrchestrationEvent(
      state,
      makeEvent("project.created", {
        projectId: recreatedProjectId,
        title: "Project Recreated",
        workspaceRoot: "/tmp/project",
        defaultModelSelection: {
          instanceId: ProviderInstanceId.make("codex"),
          model: DEFAULT_MODEL,
        },
        scripts: [],
        createdAt: "2026-02-27T00:00:01.000Z",
        updatedAt: "2026-02-27T00:00:01.000Z",
      }),
      localEnvironmentId,
    );

    expect(projectsOf(next)).toHaveLength(1);
    expect(projectsOf(next)[0]?.id).toBe(recreatedProjectId);
    expect(projectsOf(next)[0]?.cwd).toBe("/tmp/project");
    expect(projectsOf(next)[0]?.name).toBe("Project Recreated");
    expect(localEnvironmentStateOf(next).projectIds).toEqual([recreatedProjectId]);
    expect(localEnvironmentStateOf(next).projectById[originalProjectId]).toBeUndefined();
    expect(localEnvironmentStateOf(next).projectById[recreatedProjectId]?.id).toBe(
      recreatedProjectId,
    );
  });

  it("removes stale project index entries when session.created recreates a session under a new project", () => {
    const originalProjectId = ProjectId.make("project-1");
    const recreatedProjectId = ProjectId.make("project-2");
    const sessionId = SessionId.make("session-1");
    const session = makeSession({
      id: sessionId,
      projectId: originalProjectId,
    });
    const state = withActiveEnvironmentState(localEnvironmentStateOf(makeState(session)), {
      projectIds: [originalProjectId, recreatedProjectId],
      projectById: {
        [originalProjectId]: {
          id: originalProjectId,
          environmentId: localEnvironmentId,
          name: "Project 1",
          cwd: "/tmp/project-1",
          defaultModelSelection: {
            instanceId: ProviderInstanceId.make("codex"),
            model: DEFAULT_MODEL,
          },
          createdAt: "2026-02-27T00:00:00.000Z",
          updatedAt: "2026-02-27T00:00:00.000Z",
          scripts: [],
        },
        [recreatedProjectId]: {
          id: recreatedProjectId,
          environmentId: localEnvironmentId,
          name: "Project 2",
          cwd: "/tmp/project-2",
          defaultModelSelection: {
            instanceId: ProviderInstanceId.make("codex"),
            model: DEFAULT_MODEL,
          },
          createdAt: "2026-02-27T00:00:00.000Z",
          updatedAt: "2026-02-27T00:00:00.000Z",
          scripts: [],
        },
      },
    });

    const next = applyOrchestrationEvent(
      state,
      makeEvent("session.created", {
        sessionId,
        projectId: recreatedProjectId,
        title: "Recovered session",
        modelSelection: {
          instanceId: ProviderInstanceId.make("codex"),
          model: DEFAULT_MODEL,
        },
        runtimeMode: DEFAULT_RUNTIME_MODE,
        interactionMode: DEFAULT_INTERACTION_MODE,
        branch: null,
        worktreePath: null,
        createdAt: "2026-02-27T00:00:01.000Z",
        updatedAt: "2026-02-27T00:00:01.000Z",
      }),
      localEnvironmentId,
    );

    expect(sessionsOf(next)).toHaveLength(1);
    expect(sessionsOf(next)[0]?.projectId).toBe(recreatedProjectId);
    expect(localEnvironmentStateOf(next).sessionIdsByProjectId[originalProjectId]).toBeUndefined();
    expect(localEnvironmentStateOf(next).sessionIdsByProjectId[recreatedProjectId]).toEqual([
      sessionId,
    ]);
  });

  it("hydrates research cards from session detail snapshots", () => {
    const card = makeResearchCard({
      id: ResearchCardId.make("card-snapshot"),
      title: "Snapshot card",
    });

    const next = syncServerSessionDetail(
      makeEmptyState(),
      makeServerSession({ researchCards: [card] }),
      localEnvironmentId,
    );

    expect(sessionsOf(next)[0]?.researchCards).toEqual([card]);
    expect(
      localEnvironmentStateOf(next).researchCardIdsBySessionId[SessionId.make("session-1")],
    ).toEqual([card.id]);
  });

  it("applies research card proposed, updated, and reviewed events", () => {
    const card = makeResearchCard({
      id: ResearchCardId.make("card-events"),
      review: {
        prompt: "Review this cohort definition?",
        actions: [{ id: "accept", label: "Accept" }],
      },
    });
    const proposed = applyOrchestrationEvent(
      makeState(makeSession()),
      makeEvent("session.research-card-proposed", {
        sessionId: SessionId.make("session-1"),
        researchCard: card,
      }),
      localEnvironmentId,
    );
    expect(sessionsOf(proposed)[0]?.researchCards[0]?.title).toBe("Baseline cohort");

    const updatedCard = makeResearchCard({
      ...card,
      status: "changes-requested",
      title: "Updated cohort",
      updatedAt: "2026-02-13T00:00:02.000Z",
    });
    const updated = applyOrchestrationEvent(
      proposed,
      makeEvent("session.research-card-updated", {
        sessionId: SessionId.make("session-1"),
        cardId: card.id,
        researchCard: updatedCard,
      }),
      localEnvironmentId,
    );
    expect(sessionsOf(updated)[0]?.researchCards).toMatchObject([
      { id: card.id, title: "Updated cohort", status: "changes-requested" },
    ]);

    const reviewed = applyOrchestrationEvent(
      updated,
      makeEvent("session.research-card-reviewed", {
        sessionId: SessionId.make("session-1"),
        cardId: card.id,
        response: {
          action: "accept",
          summary: "Looks correct.",
          timestamp: "2026-02-13T00:00:03.000Z",
        },
      }),
      localEnvironmentId,
    );

    expect(sessionsOf(reviewed)[0]?.researchCards[0]?.review?.response).toMatchObject({
      action: "accept",
      summary: "Looks correct.",
    });
    expect(sessionsOf(reviewed)[0]?.researchCards[0]?.status).toBe("accepted");
    expect(sessionsOf(reviewed)[0]?.researchCards[0]?.updatedAt).toBe("2026-02-13T00:00:03.000Z");

    const lifecycleUpdated = applyOrchestrationEvent(
      reviewed,
      makeEvent("session.research-card-lifecycle-updated", {
        sessionId: SessionId.make("session-1"),
        cardId: card.id,
        status: "withdrawn",
        action: "withdraw",
        updatedAt: "2026-02-13T00:00:04.000Z",
      }),
      localEnvironmentId,
    );
    expect(sessionsOf(lifecycleUpdated)[0]?.researchCards[0]).toMatchObject({
      id: card.id,
      status: "withdrawn",
      updatedAt: "2026-02-13T00:00:04.000Z",
    });

    const replacementCard = makeResearchCard({
      id: ResearchCardId.make("card-replacement"),
      title: "Replacement cohort",
      createdAt: "2026-02-13T00:00:05.000Z",
      updatedAt: "2026-02-13T00:00:05.000Z",
    });
    const superseded = applyOrchestrationEvent(
      lifecycleUpdated,
      makeEvent("session.research-card-superseded", {
        sessionId: SessionId.make("session-1"),
        cardId: card.id,
        replacementCard,
        supersededAt: "2026-02-13T00:00:05.000Z",
      }),
      localEnvironmentId,
    );
    expect(sessionsOf(superseded)[0]?.researchCards).toMatchObject([
      { id: card.id, status: "superseded" },
      { id: replacementCard.id, title: "Replacement cohort" },
    ]);
  });

  it("preserves research card review responses without an existing review envelope", () => {
    const card = makeResearchCard({
      id: ResearchCardId.make("card-reviewless"),
      review: undefined,
    });
    const reviewed = applyOrchestrationEvent(
      makeState(makeSession({ researchCards: [card] })),
      makeEvent("session.research-card-reviewed", {
        sessionId: SessionId.make("session-1"),
        cardId: card.id,
        response: {
          action: "request_changes",
          summary: "Needs more detail.",
          timestamp: "2026-02-13T00:00:03.000Z",
        },
      }),
      localEnvironmentId,
    );

    expect(sessionsOf(reviewed)[0]?.researchCards[0]?.status).toBe("changes-requested");
    expect(sessionsOf(reviewed)[0]?.researchCards[0]?.review).toEqual({
      prompt: "Human review",
      actions: [],
      response: {
        action: "request_changes",
        summary: "Needs more detail.",
        timestamp: "2026-02-13T00:00:03.000Z",
      },
    });
  });

  it("clears research card slices when a session is removed", () => {
    const session = makeSession({
      researchCards: [makeResearchCard({ id: ResearchCardId.make("card-remove") })],
    });

    const next = applyOrchestrationEvent(
      makeState(session),
      makeEvent("session.deleted", {
        sessionId: session.id,
        deletedAt: "2026-02-13T00:00:02.000Z",
      }),
      localEnvironmentId,
    );

    expect(localEnvironmentStateOf(next).researchCardIdsBySessionId[session.id]).toBeUndefined();
    expect(localEnvironmentStateOf(next).researchCardBySessionId[session.id]).toBeUndefined();
  });

  it("updates only the affected session for message events", () => {
    const session1 = makeSession({
      id: SessionId.make("session-1"),
      messages: [
        {
          id: MessageId.make("message-1"),
          role: "assistant",
          text: "hello",
          turnId: TurnId.make("turn-1"),
          createdAt: "2026-02-27T00:00:00.000Z",
          completedAt: "2026-02-27T00:00:00.000Z",
          streaming: false,
        },
      ],
    });
    const session2 = makeSession({ id: SessionId.make("session-2") });
    const baseState = makeState(session1);
    const baseEnvironmentState = localEnvironmentStateOf(baseState);
    const state = withActiveEnvironmentState(baseEnvironmentState, {
      sessionIds: [session1.id, session2.id],
      sessionShellById: {
        ...baseEnvironmentState.sessionShellById,
        [session2.id]: {
          id: session2.id,
          environmentId: session2.environmentId,
          codexSessionId: session2.codexSessionId,
          projectId: session2.projectId,
          title: session2.title,
          modelSelection: session2.modelSelection,
          runtimeMode: session2.runtimeMode,
          interactionMode: session2.interactionMode,
          error: session2.error,
          createdAt: session2.createdAt,
          archivedAt: session2.archivedAt,
          updatedAt: session2.updatedAt,
          branch: session2.branch,
          worktreePath: session2.worktreePath,
        },
      },
      providerRuntimeById: {
        ...baseEnvironmentState.providerRuntimeById,
        [session2.id]: session2.session,
      },
      sessionTurnStateById: {
        ...baseEnvironmentState.sessionTurnStateById,
        [session2.id]: {
          latestTurn: session2.latestTurn,
        },
      },
      messageIdsBySessionId: {
        ...baseEnvironmentState.messageIdsBySessionId,
        [session2.id]: [],
      },
      messageBySessionId: {
        ...baseEnvironmentState.messageBySessionId,
        [session2.id]: {},
      },
      activityIdsBySessionId: {
        ...baseEnvironmentState.activityIdsBySessionId,
        [session2.id]: [],
      },
      activityBySessionId: {
        ...baseEnvironmentState.activityBySessionId,
        [session2.id]: {},
      },
      proposedPlanIdsBySessionId: {
        ...baseEnvironmentState.proposedPlanIdsBySessionId,
        [session2.id]: [],
      },
      proposedPlanBySessionId: {
        ...baseEnvironmentState.proposedPlanBySessionId,
        [session2.id]: {},
      },
      researchCardIdsBySessionId: {
        ...baseEnvironmentState.researchCardIdsBySessionId,
        [session2.id]: [],
      },
      researchCardBySessionId: {
        ...baseEnvironmentState.researchCardBySessionId,
        [session2.id]: {},
      },
      turnDiffIdsBySessionId: {
        ...baseEnvironmentState.turnDiffIdsBySessionId,
        [session2.id]: [],
      },
      turnDiffSummaryBySessionId: {
        ...baseEnvironmentState.turnDiffSummaryBySessionId,
        [session2.id]: {},
      },
      sidebarSessionSummaryById: {
        ...baseEnvironmentState.sidebarSessionSummaryById,
      },
      sessionIdsByProjectId: {
        [session1.projectId]: [session1.id, session2.id],
      },
    });

    const next = applyOrchestrationEvent(
      state,
      makeEvent("session.message-sent", {
        sessionId: session1.id,
        messageId: MessageId.make("message-1"),
        role: "assistant",
        text: " world",
        turnId: TurnId.make("turn-1"),
        streaming: true,
        createdAt: "2026-02-27T00:00:01.000Z",
        updatedAt: "2026-02-27T00:00:01.000Z",
      }),
      localEnvironmentId,
    );

    expect(sessionsOf(next)[0]?.messages[0]?.text).toBe("hello world");
    expect(sessionsOf(next)[0]?.latestTurn?.state).toBe("running");
    const nextEnvironmentState = next.environmentStateById[localEnvironmentId];
    const previousEnvironmentState = state.environmentStateById[localEnvironmentId];
    expect(nextEnvironmentState?.sessionShellById[session2.id]).toBe(
      previousEnvironmentState?.sessionShellById[session2.id],
    );
    expect(nextEnvironmentState?.providerRuntimeById[session2.id]).toBe(
      previousEnvironmentState?.providerRuntimeById[session2.id],
    );
    expect(nextEnvironmentState?.messageIdsBySessionId[session2.id]).toBe(
      previousEnvironmentState?.messageIdsBySessionId[session2.id],
    );
    expect(nextEnvironmentState?.messageBySessionId[session2.id]).toBe(
      previousEnvironmentState?.messageBySessionId[session2.id],
    );
  });

  it("applies replay batches in sequence and updates session state", () => {
    const session = makeSession({
      latestTurn: {
        turnId: TurnId.make("turn-1"),
        state: "running",
        requestedAt: "2026-02-27T00:00:00.000Z",
        startedAt: "2026-02-27T00:00:00.000Z",
        completedAt: null,
        assistantMessageId: null,
      },
    });
    const state = makeState(session);

    const next = applyOrchestrationEvents(
      state,
      [
        makeEvent(
          "session.session-set",
          {
            sessionId: session.id,
            session: {
              sessionId: session.id,
              status: "running",
              providerName: "codex",
              runtimeMode: "full-access",
              activeTurnId: TurnId.make("turn-1"),
              lastError: null,
              updatedAt: "2026-02-27T00:00:02.000Z",
            },
          },
          { sequence: 2 },
        ),
        makeEvent(
          "session.message-sent",
          {
            sessionId: session.id,
            messageId: MessageId.make("assistant-1"),
            role: "assistant",
            text: "done",
            turnId: TurnId.make("turn-1"),
            streaming: false,
            createdAt: "2026-02-27T00:00:03.000Z",
            updatedAt: "2026-02-27T00:00:03.000Z",
          },
          { sequence: 3 },
        ),
      ],
      localEnvironmentId,
    );

    expect(sessionsOf(next)[0]?.session?.status).toBe("running");
    expect(sessionsOf(next)[0]?.latestTurn?.state).toBe("completed");
    expect(sessionsOf(next)[0]?.messages).toHaveLength(1);
  });

  it("does not regress latestTurn when an older turn diff completes late", () => {
    const state = makeState(
      makeSession({
        latestTurn: {
          turnId: TurnId.make("turn-2"),
          state: "running",
          requestedAt: "2026-02-27T00:00:02.000Z",
          startedAt: "2026-02-27T00:00:03.000Z",
          completedAt: null,
          assistantMessageId: null,
        },
      }),
    );

    const next = applyOrchestrationEvent(
      state,
      makeEvent("session.turn-diff-completed", {
        sessionId: SessionId.make("session-1"),
        turnId: TurnId.make("turn-1"),
        checkpointTurnCount: 1,
        checkpointRef: CheckpointRef.make("checkpoint-1"),
        status: "ready",
        files: [],
        assistantMessageId: MessageId.make("assistant-1"),
        completedAt: "2026-02-27T00:00:04.000Z",
      }),
      localEnvironmentId,
    );

    expect(sessionsOf(next)[0]?.turnDiffSummaries).toHaveLength(1);
    expect(sessionsOf(next)[0]?.latestTurn).toEqual(sessionsOf(state)[0]?.latestTurn);
  });

  it("rebinds live turn diffs to the authoritative assistant message when it arrives later", () => {
    const turnId = TurnId.make("turn-1");
    const state = makeState(
      makeSession({
        latestTurn: {
          turnId,
          state: "completed",
          requestedAt: "2026-02-27T00:00:00.000Z",
          startedAt: "2026-02-27T00:00:00.000Z",
          completedAt: "2026-02-27T00:00:02.000Z",
          assistantMessageId: MessageId.make("assistant:turn-1"),
        },
        turnDiffSummaries: [
          {
            turnId,
            completedAt: "2026-02-27T00:00:02.000Z",
            status: "ready",
            checkpointTurnCount: 1,
            checkpointRef: CheckpointRef.make("checkpoint-1"),
            assistantMessageId: MessageId.make("assistant:turn-1"),
            files: [{ path: "src/app.ts", additions: 1, deletions: 0 }],
          },
        ],
      }),
    );

    const next = applyOrchestrationEvent(
      state,
      makeEvent("session.message-sent", {
        sessionId: SessionId.make("session-1"),
        messageId: MessageId.make("assistant-real"),
        role: "assistant",
        text: "final answer",
        turnId,
        streaming: false,
        createdAt: "2026-02-27T00:00:03.000Z",
        updatedAt: "2026-02-27T00:00:03.000Z",
      }),
      localEnvironmentId,
    );

    expect(sessionsOf(next)[0]?.turnDiffSummaries[0]?.assistantMessageId).toBe(
      MessageId.make("assistant-real"),
    );
    expect(sessionsOf(next)[0]?.latestTurn?.assistantMessageId).toBe(
      MessageId.make("assistant-real"),
    );
  });

  it("reverts messages, plans, activities, and checkpoints by retained turns", () => {
    const state = makeState(
      makeSession({
        messages: [
          {
            id: MessageId.make("user-1"),
            role: "user",
            text: "first",
            turnId: TurnId.make("turn-1"),
            createdAt: "2026-02-27T00:00:00.000Z",
            completedAt: "2026-02-27T00:00:00.000Z",
            streaming: false,
          },
          {
            id: MessageId.make("assistant-1"),
            role: "assistant",
            text: "first reply",
            turnId: TurnId.make("turn-1"),
            createdAt: "2026-02-27T00:00:01.000Z",
            completedAt: "2026-02-27T00:00:01.000Z",
            streaming: false,
          },
          {
            id: MessageId.make("user-2"),
            role: "user",
            text: "second",
            turnId: TurnId.make("turn-2"),
            createdAt: "2026-02-27T00:00:02.000Z",
            completedAt: "2026-02-27T00:00:02.000Z",
            streaming: false,
          },
        ],
        proposedPlans: [
          {
            id: "plan-1",
            turnId: TurnId.make("turn-1"),
            planMarkdown: "plan 1",
            implementedAt: null,
            implementationSessionId: null,
            createdAt: "2026-02-27T00:00:00.000Z",
            updatedAt: "2026-02-27T00:00:00.000Z",
          },
          {
            id: "plan-2",
            turnId: TurnId.make("turn-2"),
            planMarkdown: "plan 2",
            implementedAt: null,
            implementationSessionId: null,
            createdAt: "2026-02-27T00:00:02.000Z",
            updatedAt: "2026-02-27T00:00:02.000Z",
          },
        ],
        researchCards: [
          makeResearchCard({
            id: ResearchCardId.make("card-global"),
            title: "Global card",
            turnId: null,
          }),
          makeResearchCard({
            id: ResearchCardId.make("card-turn-1"),
            title: "Turn 1 card",
            turnId: TurnId.make("turn-1"),
          }),
          makeResearchCard({
            id: ResearchCardId.make("card-turn-2"),
            title: "Turn 2 card",
            turnId: TurnId.make("turn-2"),
          }),
        ],
        activities: [
          {
            id: EventId.make("activity-1"),
            tone: "info",
            kind: "step",
            summary: "one",
            payload: {},
            turnId: TurnId.make("turn-1"),
            createdAt: "2026-02-27T00:00:00.000Z",
          },
          {
            id: EventId.make("activity-2"),
            tone: "info",
            kind: "step",
            summary: "two",
            payload: {},
            turnId: TurnId.make("turn-2"),
            createdAt: "2026-02-27T00:00:02.000Z",
          },
        ],
        turnDiffSummaries: [
          {
            turnId: TurnId.make("turn-1"),
            completedAt: "2026-02-27T00:00:01.000Z",
            status: "ready",
            checkpointTurnCount: 1,
            checkpointRef: CheckpointRef.make("ref-1"),
            files: [],
          },
          {
            turnId: TurnId.make("turn-2"),
            completedAt: "2026-02-27T00:00:03.000Z",
            status: "ready",
            checkpointTurnCount: 2,
            checkpointRef: CheckpointRef.make("ref-2"),
            files: [],
          },
        ],
      }),
    );

    const next = applyOrchestrationEvent(
      state,
      makeEvent("session.reverted", {
        sessionId: SessionId.make("session-1"),
        turnCount: 1,
      }),
      localEnvironmentId,
    );

    expect(sessionsOf(next)[0]?.messages.map((message) => message.id)).toEqual([
      "user-1",
      "assistant-1",
    ]);
    expect(sessionsOf(next)[0]?.proposedPlans.map((plan) => plan.id)).toEqual(["plan-1"]);
    expect(sessionsOf(next)[0]?.researchCards.map((card) => card.id)).toEqual([
      ResearchCardId.make("card-global"),
      ResearchCardId.make("card-turn-1"),
    ]);
    expect(sessionsOf(next)[0]?.activities.map((activity) => activity.id)).toEqual([
      EventId.make("activity-1"),
    ]);
    expect(sessionsOf(next)[0]?.turnDiffSummaries.map((summary) => summary.turnId)).toEqual([
      TurnId.make("turn-1"),
    ]);
  });

  it("clears pending source proposed plans after revert before a new session-set event", () => {
    const session = makeSession({
      latestTurn: {
        turnId: TurnId.make("turn-2"),
        state: "completed",
        requestedAt: "2026-02-27T00:00:02.000Z",
        startedAt: "2026-02-27T00:00:02.000Z",
        completedAt: "2026-02-27T00:00:03.000Z",
        assistantMessageId: MessageId.make("assistant-2"),
        sourceProposedPlan: {
          sessionId: SessionId.make("session-source"),
          planId: "plan-2" as never,
        },
      },
      pendingSourceProposedPlan: {
        sessionId: SessionId.make("session-source"),
        planId: "plan-2" as never,
      },
      turnDiffSummaries: [
        {
          turnId: TurnId.make("turn-1"),
          completedAt: "2026-02-27T00:00:01.000Z",
          status: "ready",
          checkpointTurnCount: 1,
          checkpointRef: CheckpointRef.make("ref-1"),
          files: [],
        },
        {
          turnId: TurnId.make("turn-2"),
          completedAt: "2026-02-27T00:00:03.000Z",
          status: "ready",
          checkpointTurnCount: 2,
          checkpointRef: CheckpointRef.make("ref-2"),
          files: [],
        },
      ],
    });
    const reverted = applyOrchestrationEvent(
      makeState(session),
      makeEvent("session.reverted", {
        sessionId: session.id,
        turnCount: 1,
      }),
      localEnvironmentId,
    );

    expect(sessionsOf(reverted)[0]?.pendingSourceProposedPlan).toBeUndefined();

    const next = applyOrchestrationEvent(
      reverted,
      makeEvent("session.session-set", {
        sessionId: session.id,
        session: {
          sessionId: session.id,
          status: "running",
          providerName: "codex",
          runtimeMode: "full-access",
          activeTurnId: TurnId.make("turn-3"),
          lastError: null,
          updatedAt: "2026-02-27T00:00:04.000Z",
        },
      }),
      localEnvironmentId,
    );

    expect(sessionsOf(next)[0]?.latestTurn).toMatchObject({
      turnId: TurnId.make("turn-3"),
      state: "running",
    });
    expect(sessionsOf(next)[0]?.latestTurn?.sourceProposedPlan).toBeUndefined();
  });
});
