import { scopeSessionRef } from "@t3tools/client-runtime";
import {
  EnvironmentId,
  MessageId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  SessionId,
  TurnId,
} from "@t3tools/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type EnvironmentState, useStore } from "../store";
import { type Session } from "../types";

import {
  MAX_HIDDEN_MOUNTED_TERMINAL_THREADS,
  buildExpiredTerminalContextToastCopy,
  createLocalDispatchSnapshot,
  deriveComposerSendState,
  hasServerAcknowledgedLocalDispatch,
  reconcileMountedTerminalSessionIds,
  resolveSendEnvMode,
  shouldWriteSessionErrorToCurrentServerSession,
  waitForStartedServerSession,
} from "./ChatView.logic";

const localEnvironmentId = EnvironmentId.make("environment-local");

describe("deriveComposerSendState", () => {
  it("treats expired terminal pills as non-sendable content", () => {
    const state = deriveComposerSendState({
      prompt: "\uFFFC",
      imageCount: 0,
      terminalContexts: [
        {
          id: "ctx-expired",
          sessionId: SessionId.make("session-1"),
          terminalId: "default",
          terminalLabel: "Terminal 1",
          lineStart: 4,
          lineEnd: 4,
          text: "",
          createdAt: "2026-03-17T12:52:29.000Z",
        },
      ],
    });

    expect(state.trimmedPrompt).toBe("");
    expect(state.sendableTerminalContexts).toEqual([]);
    expect(state.expiredTerminalContextCount).toBe(1);
    expect(state.hasSendableContent).toBe(false);
  });

  it("keeps text sendable while excluding expired terminal pills", () => {
    const state = deriveComposerSendState({
      prompt: `yoo \uFFFC waddup`,
      imageCount: 0,
      terminalContexts: [
        {
          id: "ctx-expired",
          sessionId: SessionId.make("session-1"),
          terminalId: "default",
          terminalLabel: "Terminal 1",
          lineStart: 4,
          lineEnd: 4,
          text: "",
          createdAt: "2026-03-17T12:52:29.000Z",
        },
      ],
    });

    expect(state.trimmedPrompt).toBe("yoo  waddup");
    expect(state.expiredTerminalContextCount).toBe(1);
    expect(state.hasSendableContent).toBe(true);
  });
});

describe("buildExpiredTerminalContextToastCopy", () => {
  it("formats clear empty-state guidance", () => {
    expect(buildExpiredTerminalContextToastCopy(1, "empty")).toEqual({
      title: "Expired terminal context won't be sent",
      description: "Remove it or re-add it to include terminal output.",
    });
  });

  it("formats omission guidance for sent messages", () => {
    expect(buildExpiredTerminalContextToastCopy(2, "omitted")).toEqual({
      title: "Expired terminal contexts omitted from message",
      description: "Re-add it if you want that terminal output included.",
    });
  });
});

describe("resolveSendEnvMode", () => {
  it("keeps worktree mode for git repositories", () => {
    expect(resolveSendEnvMode({ requestedEnvMode: "worktree", isGitRepo: true })).toBe("worktree");
  });

  it("forces local mode for non-git repositories", () => {
    expect(resolveSendEnvMode({ requestedEnvMode: "worktree", isGitRepo: false })).toBe("local");
    expect(resolveSendEnvMode({ requestedEnvMode: "local", isGitRepo: false })).toBe("local");
  });
});

describe("reconcileMountedTerminalSessionIds", () => {
  it("keeps previously mounted open sessions and adds the active open session", () => {
    expect(
      reconcileMountedTerminalSessionIds({
        currentSessionIds: [SessionId.make("session-hidden"), SessionId.make("session-stale")],
        openSessionIds: [SessionId.make("session-hidden"), SessionId.make("session-active")],
        activeSessionId: SessionId.make("session-active"),
        activeSessionTerminalOpen: true,
      }),
    ).toEqual([SessionId.make("session-hidden"), SessionId.make("session-active")]);
  });

  it("drops mounted sessions once their terminal drawer is no longer open", () => {
    expect(
      reconcileMountedTerminalSessionIds({
        currentSessionIds: [SessionId.make("session-closed")],
        openSessionIds: [],
        activeSessionId: SessionId.make("session-closed"),
        activeSessionTerminalOpen: false,
      }),
    ).toEqual([]);
  });

  it("keeps only the most recently active hidden terminal sessions", () => {
    expect(
      reconcileMountedTerminalSessionIds({
        currentSessionIds: [
          SessionId.make("session-1"),
          SessionId.make("session-2"),
          SessionId.make("session-3"),
        ],
        openSessionIds: [
          SessionId.make("session-1"),
          SessionId.make("session-2"),
          SessionId.make("session-3"),
          SessionId.make("session-4"),
        ],
        activeSessionId: SessionId.make("session-4"),
        activeSessionTerminalOpen: true,
        maxHiddenSessionCount: 2,
      }),
    ).toEqual([
      SessionId.make("session-2"),
      SessionId.make("session-3"),
      SessionId.make("session-4"),
    ]);
  });

  it("moves the active session to the end so it is treated as most recently used", () => {
    expect(
      reconcileMountedTerminalSessionIds({
        currentSessionIds: [
          SessionId.make("session-a"),
          SessionId.make("session-b"),
          SessionId.make("session-c"),
        ],
        openSessionIds: [
          SessionId.make("session-a"),
          SessionId.make("session-b"),
          SessionId.make("session-c"),
        ],
        activeSessionId: SessionId.make("session-a"),
        activeSessionTerminalOpen: true,
        maxHiddenSessionCount: 2,
      }),
    ).toEqual([
      SessionId.make("session-b"),
      SessionId.make("session-c"),
      SessionId.make("session-a"),
    ]);
  });

  it("defaults to the hidden mounted terminal cap", () => {
    const currentSessionIds = Array.from(
      { length: MAX_HIDDEN_MOUNTED_TERMINAL_THREADS + 2 },
      (_, index) => SessionId.make(`session-${index + 1}`),
    );

    expect(
      reconcileMountedTerminalSessionIds({
        currentSessionIds,
        openSessionIds: currentSessionIds,
        activeSessionId: null,
        activeSessionTerminalOpen: false,
      }),
    ).toEqual(currentSessionIds.slice(-MAX_HIDDEN_MOUNTED_TERMINAL_THREADS));
  });
});

describe("shouldWriteSessionErrorToCurrentServerSession", () => {
  it("routes errors to the active server session when route and target match", () => {
    const sessionId = SessionId.make("session-1");
    const routeSessionRef = scopeSessionRef(localEnvironmentId, sessionId);

    expect(
      shouldWriteSessionErrorToCurrentServerSession({
        serverSession: {
          environmentId: localEnvironmentId,
          id: sessionId,
        },
        routeSessionRef,
        targetSessionId: sessionId,
      }),
    ).toBe(true);
  });

  it("does not route draft-session errors into server-backed state", () => {
    const sessionId = SessionId.make("session-1");

    expect(
      shouldWriteSessionErrorToCurrentServerSession({
        serverSession: undefined,
        routeSessionRef: scopeSessionRef(localEnvironmentId, sessionId),
        targetSessionId: sessionId,
      }),
    ).toBe(false);
  });
});

const makeSession = (input?: {
  id?: SessionId;
  latestTurn?: {
    turnId: TurnId;
    state: "running" | "completed";
    requestedAt: string;
    startedAt: string | null;
    completedAt: string | null;
  } | null;
}): Session => ({
  id: input?.id ?? SessionId.make("session-1"),
  environmentId: localEnvironmentId,
  codexSessionId: null,
  projectId: ProjectId.make("project-1"),
  title: "Session",
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
  runtimeMode: "full-access" as const,
  interactionMode: "default" as const,
  session: null,
  messages: [],
  proposedPlans: [],
  error: null,
  createdAt: "2026-03-29T00:00:00.000Z",
  archivedAt: null,
  settledOverride: null,
  settledAt: null,
  snoozedUntil: null,
  snoozedAt: null,
  updatedAt: "2026-03-29T00:00:00.000Z",
  latestTurn: input?.latestTurn
    ? {
        ...input.latestTurn,
        assistantMessageId: null,
      }
    : null,
  branch: null,
  worktreePath: null,
  turnDiffSummaries: [],
  activities: [],
});

function setStoreSessions(sessions: ReadonlyArray<ReturnType<typeof makeSession>>) {
  const projectId = ProjectId.make("project-1");
  const environmentState: EnvironmentState = {
    projectIds: [projectId],
    projectById: {
      [projectId]: {
        id: projectId,
        environmentId: localEnvironmentId,
        name: "Project",
        cwd: "/tmp/project",
        defaultModelSelection: {
          instanceId: ProviderInstanceId.make("codex"),
          model: "gpt-5.4",
        },
        createdAt: "2026-03-29T00:00:00.000Z",
        updatedAt: "2026-03-29T00:00:00.000Z",
        scripts: [],
      },
    },
    sessionIds: sessions.map((session) => session.id),
    sessionIdsByProjectId: {
      [projectId]: sessions.map((session) => session.id),
    },
    sessionShellById: Object.fromEntries(
      sessions.map((session) => [
        session.id,
        {
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
          settledOverride: session.settledOverride,
          settledAt: session.settledAt,
          snoozedUntil: session.snoozedUntil,
          snoozedAt: session.snoozedAt,
          updatedAt: session.updatedAt,
          branch: session.branch,
          worktreePath: session.worktreePath,
        },
      ]),
    ),
    providerRuntimeById: Object.fromEntries(
      sessions.map((session) => [session.id, session.session]),
    ),
    sessionTurnStateById: Object.fromEntries(
      sessions.map((session) => [
        session.id,
        {
          latestTurn: session.latestTurn,
          ...(session.pendingSourceProposedPlan
            ? { pendingSourceProposedPlan: session.pendingSourceProposedPlan }
            : {}),
        },
      ]),
    ),
    messageIdsBySessionId: Object.fromEntries(
      sessions.map((session) => [session.id, session.messages.map((message) => message.id)]),
    ),
    messageBySessionId: Object.fromEntries(
      sessions.map((session) => [
        session.id,
        Object.fromEntries(session.messages.map((message) => [message.id, message])),
      ]),
    ),
    activityIdsBySessionId: Object.fromEntries(
      sessions.map((session) => [session.id, session.activities.map((activity) => activity.id)]),
    ),
    activityBySessionId: Object.fromEntries(
      sessions.map((session) => [
        session.id,
        Object.fromEntries(session.activities.map((activity) => [activity.id, activity])),
      ]),
    ),
    proposedPlanIdsBySessionId: Object.fromEntries(
      sessions.map((session) => [session.id, session.proposedPlans.map((plan) => plan.id)]),
    ),
    proposedPlanBySessionId: Object.fromEntries(
      sessions.map((session) => [
        session.id,
        Object.fromEntries(session.proposedPlans.map((plan) => [plan.id, plan])),
      ]),
    ),
    turnDiffIdsBySessionId: Object.fromEntries(
      sessions.map((session) => [
        session.id,
        session.turnDiffSummaries.map((summary) => summary.turnId),
      ]),
    ),
    turnDiffSummaryBySessionId: Object.fromEntries(
      sessions.map((session) => [
        session.id,
        Object.fromEntries(session.turnDiffSummaries.map((summary) => [summary.turnId, summary])),
      ]),
    ),
    sidebarSessionSummaryById: {},
    bootstrapComplete: true,
  };
  useStore.setState({
    activeEnvironmentId: localEnvironmentId,
    environmentStateById: {
      [localEnvironmentId]: environmentState,
    },
  });
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  setStoreSessions([]);
});

describe("waitForStartedServerSession", () => {
  it("resolves immediately when the session is already started", async () => {
    const sessionId = SessionId.make("session-started");
    setStoreSessions([
      makeSession({
        id: sessionId,
        latestTurn: {
          turnId: TurnId.make("turn-started"),
          state: "running",
          requestedAt: "2026-03-29T00:00:01.000Z",
          startedAt: "2026-03-29T00:00:01.000Z",
          completedAt: null,
        },
      }),
    ]);

    await expect(
      waitForStartedServerSession(scopeSessionRef(localEnvironmentId, sessionId)),
    ).resolves.toBe(true);
  });

  it("waits for the session to start via subscription updates", async () => {
    const sessionId = SessionId.make("session-wait");
    setStoreSessions([makeSession({ id: sessionId })]);

    const promise = waitForStartedServerSession(
      scopeSessionRef(localEnvironmentId, sessionId),
      500,
    );

    setStoreSessions([
      makeSession({
        id: sessionId,
        latestTurn: {
          turnId: TurnId.make("turn-started"),
          state: "running",
          requestedAt: "2026-03-29T00:00:01.000Z",
          startedAt: "2026-03-29T00:00:01.000Z",
          completedAt: null,
        },
      }),
    ]);

    await expect(promise).resolves.toBe(true);
  });

  it("handles the session starting between the initial read and subscription setup", async () => {
    const sessionId = SessionId.make("session-race");
    setStoreSessions([makeSession({ id: sessionId })]);

    const originalSubscribe = useStore.subscribe.bind(useStore);
    let raced = false;
    vi.spyOn(useStore, "subscribe").mockImplementation((listener) => {
      if (!raced) {
        raced = true;
        setStoreSessions([
          makeSession({
            id: sessionId,
            latestTurn: {
              turnId: TurnId.make("turn-race"),
              state: "running",
              requestedAt: "2026-03-29T00:00:01.000Z",
              startedAt: "2026-03-29T00:00:01.000Z",
              completedAt: null,
            },
          }),
        ]);
      }
      return originalSubscribe(listener);
    });

    await expect(
      waitForStartedServerSession(scopeSessionRef(localEnvironmentId, sessionId), 500),
    ).resolves.toBe(true);
  });

  it("returns false after the timeout when the session never starts", async () => {
    vi.useFakeTimers();

    const sessionId = SessionId.make("session-timeout");
    setStoreSessions([makeSession({ id: sessionId })]);
    const promise = waitForStartedServerSession(
      scopeSessionRef(localEnvironmentId, sessionId),
      500,
    );

    await vi.advanceTimersByTimeAsync(500);

    await expect(promise).resolves.toBe(false);
  });
});

describe("hasServerAcknowledgedLocalDispatch", () => {
  const projectId = ProjectId.make("project-1");
  const previousLatestTurn = {
    turnId: TurnId.make("turn-1"),
    state: "completed" as const,
    requestedAt: "2026-03-29T00:00:00.000Z",
    startedAt: "2026-03-29T00:00:01.000Z",
    completedAt: "2026-03-29T00:00:10.000Z",
    assistantMessageId: null,
  };

  const previousSession = {
    provider: ProviderDriverKind.make("codex"),
    status: "ready" as const,
    createdAt: "2026-03-29T00:00:00.000Z",
    updatedAt: "2026-03-29T00:00:10.000Z",
    orchestrationStatus: "idle" as const,
  };

  it("does not clear local dispatch before server state changes", () => {
    const localDispatch = createLocalDispatchSnapshot({
      id: SessionId.make("session-1"),
      environmentId: localEnvironmentId,
      codexSessionId: null,
      projectId,
      title: "Session",
      modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
      runtimeMode: "full-access",
      interactionMode: "default",
      session: previousSession,
      messages: [],
      proposedPlans: [],
      error: null,
      createdAt: "2026-03-29T00:00:00.000Z",
      archivedAt: null,
      settledOverride: null,
      settledAt: null,
      snoozedUntil: null,
      snoozedAt: null,
      updatedAt: "2026-03-29T00:00:10.000Z",
      latestTurn: previousLatestTurn,
      branch: null,
      worktreePath: null,
      turnDiffSummaries: [],
      activities: [],
    });

    expect(
      hasServerAcknowledgedLocalDispatch({
        localDispatch,
        phase: "ready",
        latestTurn: previousLatestTurn,
        session: previousSession,
        hasPendingApproval: false,
        hasPendingUserInput: false,
        sessionError: null,
      }),
    ).toBe(false);
  });

  it("clears local dispatch when a new turn is already settled", () => {
    const localDispatch = createLocalDispatchSnapshot({
      id: SessionId.make("session-1"),
      environmentId: localEnvironmentId,
      codexSessionId: null,
      projectId,
      title: "Session",
      modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
      runtimeMode: "full-access",
      interactionMode: "default",
      session: previousSession,
      messages: [],
      proposedPlans: [],
      error: null,
      createdAt: "2026-03-29T00:00:00.000Z",
      archivedAt: null,
      settledOverride: null,
      settledAt: null,
      snoozedUntil: null,
      snoozedAt: null,
      updatedAt: "2026-03-29T00:00:10.000Z",
      latestTurn: previousLatestTurn,
      branch: null,
      worktreePath: null,
      turnDiffSummaries: [],
      activities: [],
    });

    expect(
      hasServerAcknowledgedLocalDispatch({
        localDispatch,
        phase: "ready",
        latestTurn: {
          ...previousLatestTurn,
          turnId: TurnId.make("turn-2"),
          requestedAt: "2026-03-29T00:01:00.000Z",
          startedAt: "2026-03-29T00:01:01.000Z",
          completedAt: "2026-03-29T00:01:30.000Z",
        },
        session: {
          ...previousSession,
          updatedAt: "2026-03-29T00:01:30.000Z",
        },
        hasPendingApproval: false,
        hasPendingUserInput: false,
        sessionError: null,
      }),
    ).toBe(true);
  });

  it("does not clear local dispatch while the session is running a newer turn than latestTurn", () => {
    const localDispatch = createLocalDispatchSnapshot({
      id: SessionId.make("session-1"),
      environmentId: localEnvironmentId,
      codexSessionId: null,
      projectId,
      title: "Session",
      modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
      runtimeMode: "full-access",
      interactionMode: "default",
      session: previousSession,
      messages: [],
      proposedPlans: [],
      error: null,
      createdAt: "2026-03-29T00:00:00.000Z",
      archivedAt: null,
      settledOverride: null,
      settledAt: null,
      snoozedUntil: null,
      snoozedAt: null,
      updatedAt: "2026-03-29T00:00:10.000Z",
      latestTurn: previousLatestTurn,
      branch: null,
      worktreePath: null,
      turnDiffSummaries: [],
      activities: [],
    });

    expect(
      hasServerAcknowledgedLocalDispatch({
        localDispatch,
        phase: "running",
        latestTurn: previousLatestTurn,
        session: {
          ...previousSession,
          status: "running",
          orchestrationStatus: "running",
          activeTurnId: TurnId.make("turn-2"),
          updatedAt: "2026-03-29T00:01:00.000Z",
        },
        hasPendingApproval: false,
        hasPendingUserInput: false,
        sessionError: null,
      }),
    ).toBe(false);
  });

  it("does not clear local dispatch while the session is running but latestTurn has not advanced yet", () => {
    const localDispatch = createLocalDispatchSnapshot({
      id: SessionId.make("session-1"),
      environmentId: localEnvironmentId,
      codexSessionId: null,
      projectId,
      title: "Session",
      modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
      runtimeMode: "full-access",
      interactionMode: "default",
      session: previousSession,
      messages: [],
      proposedPlans: [],
      error: null,
      createdAt: "2026-03-29T00:00:00.000Z",
      archivedAt: null,
      settledOverride: null,
      settledAt: null,
      snoozedUntil: null,
      snoozedAt: null,
      updatedAt: "2026-03-29T00:00:10.000Z",
      latestTurn: previousLatestTurn,
      branch: null,
      worktreePath: null,
      turnDiffSummaries: [],
      activities: [],
    });

    expect(
      hasServerAcknowledgedLocalDispatch({
        localDispatch,
        phase: "running",
        latestTurn: previousLatestTurn,
        session: {
          ...previousSession,
          status: "running",
          orchestrationStatus: "running",
          activeTurnId: undefined,
          updatedAt: "2026-03-29T00:01:00.000Z",
        },
        hasPendingApproval: false,
        hasPendingUserInput: false,
        sessionError: null,
      }),
    ).toBe(false);
  });

  it("clears local dispatch once the running latestTurn matches the active session turn", () => {
    const localDispatch = createLocalDispatchSnapshot({
      id: SessionId.make("session-1"),
      environmentId: localEnvironmentId,
      codexSessionId: null,
      projectId,
      title: "Session",
      modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
      runtimeMode: "full-access",
      interactionMode: "default",
      session: previousSession,
      messages: [],
      proposedPlans: [],
      error: null,
      createdAt: "2026-03-29T00:00:00.000Z",
      archivedAt: null,
      settledOverride: null,
      settledAt: null,
      snoozedUntil: null,
      snoozedAt: null,
      updatedAt: "2026-03-29T00:00:10.000Z",
      latestTurn: previousLatestTurn,
      branch: null,
      worktreePath: null,
      turnDiffSummaries: [],
      activities: [],
    });

    expect(
      hasServerAcknowledgedLocalDispatch({
        localDispatch,
        phase: "running",
        latestTurn: {
          ...previousLatestTurn,
          turnId: TurnId.make("turn-2"),
          state: "running",
          requestedAt: "2026-03-29T00:01:00.000Z",
          startedAt: "2026-03-29T00:01:01.000Z",
          completedAt: null,
        },
        session: {
          ...previousSession,
          status: "running",
          orchestrationStatus: "running",
          activeTurnId: TurnId.make("turn-2"),
          updatedAt: "2026-03-29T00:01:01.000Z",
        },
        hasPendingApproval: false,
        hasPendingUserInput: false,
        sessionError: null,
      }),
    ).toBe(true);
  });

  it("acknowledges a steering message projected onto the current running turn", () => {
    const runningTurn = {
      ...previousLatestTurn,
      state: "running" as const,
      completedAt: null,
    };
    const runningSession = {
      ...previousSession,
      status: "running" as const,
      orchestrationStatus: "running" as const,
      activeTurnId: runningTurn.turnId,
    };
    const initialMessageId = MessageId.make("message-before-steer");
    const activeSession = {
      ...makeSession({ latestTurn: runningTurn }),
      session: runningSession,
      messages: [
        {
          id: initialMessageId,
          role: "user" as const,
          text: "Initial prompt",
          turnId: runningTurn.turnId,
          createdAt: runningTurn.requestedAt,
          updatedAt: runningTurn.requestedAt,
          streaming: false,
        },
      ],
    };
    const localDispatch = createLocalDispatchSnapshot(activeSession);

    expect(
      hasServerAcknowledgedLocalDispatch({
        localDispatch,
        phase: "running",
        latestTurn: runningTurn,
        latestUserMessageId: MessageId.make("message-steer"),
        session: runningSession,
        hasPendingApproval: false,
        hasPendingUserInput: false,
        sessionError: null,
      }),
    ).toBe(true);
  });

  it("clears local dispatch when the session changes without an observed running phase", () => {
    const localDispatch = createLocalDispatchSnapshot({
      id: SessionId.make("session-1"),
      environmentId: localEnvironmentId,
      codexSessionId: null,
      projectId,
      title: "Session",
      modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
      runtimeMode: "full-access",
      interactionMode: "default",
      session: previousSession,
      messages: [],
      proposedPlans: [],
      error: null,
      createdAt: "2026-03-29T00:00:00.000Z",
      archivedAt: null,
      settledOverride: null,
      settledAt: null,
      snoozedUntil: null,
      snoozedAt: null,
      updatedAt: "2026-03-29T00:00:10.000Z",
      latestTurn: previousLatestTurn,
      branch: null,
      worktreePath: null,
      turnDiffSummaries: [],
      activities: [],
    });

    expect(
      hasServerAcknowledgedLocalDispatch({
        localDispatch,
        phase: "ready",
        latestTurn: previousLatestTurn,
        session: {
          ...previousSession,
          updatedAt: "2026-03-29T00:00:11.000Z",
        },
        hasPendingApproval: false,
        hasPendingUserInput: false,
        sessionError: null,
      }),
    ).toBe(true);
  });
});
