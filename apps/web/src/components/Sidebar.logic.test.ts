import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProviderDriverKind } from "@t3tools/contracts";

import {
  createSessionJumpHintVisibilityController,
  getSidebarSessionIdsToPrewarm,
  getVisibleSidebarSessionIds,
  resolveAdjacentSessionId,
  getFallbackSessionIdAfterDelete,
  getVisibleSessionsForProject,
  getProjectSortTimestamp,
  hasUnseenCompletion,
  isContextMenuPointerDown,
  orderItemsByPreferredIds,
  resolveProjectStatusIndicator,
  resolveSidebarNewSessionSeedContext,
  resolveSidebarNewSessionEnvMode,
  resolveSessionRowClassName,
  resolveSessionStatusPill,
  shouldClearSessionSelectionOnMouseDown,
  sortProjectsForSidebar,
  THREAD_JUMP_HINT_SHOW_DELAY_MS,
} from "./Sidebar.logic";
import {
  EnvironmentId,
  OrchestrationLatestTurn,
  ProjectId,
  ProviderInstanceId,
  SessionId,
} from "@t3tools/contracts";
import {
  DEFAULT_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  type Project,
  type Session,
} from "../types";

const localEnvironmentId = EnvironmentId.make("environment-local");

function makeLatestTurn(overrides?: {
  completedAt?: string | null;
  startedAt?: string | null;
}): OrchestrationLatestTurn {
  return {
    turnId: "turn-1" as never,
    state: "completed",
    assistantMessageId: null,
    requestedAt: "2026-03-09T10:00:00.000Z",
    startedAt: overrides?.startedAt ?? "2026-03-09T10:00:00.000Z",
    completedAt: overrides?.completedAt ?? "2026-03-09T10:05:00.000Z",
  };
}

describe("hasUnseenCompletion", () => {
  it("returns true when a session completed after its last visit", () => {
    expect(
      hasUnseenCompletion({
        hasActionableProposedPlan: false,
        hasPendingApprovals: false,
        hasPendingUserInput: false,
        interactionMode: "default",
        latestTurn: makeLatestTurn(),
        lastVisitedAt: "2026-03-09T10:04:00.000Z",
        session: null,
      }),
    ).toBe(true);
  });
});

describe("createSessionJumpHintVisibilityController", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("delays showing jump hints until the configured delay elapses", () => {
    const visibilityChanges: boolean[] = [];
    const controller = createSessionJumpHintVisibilityController({
      delayMs: THREAD_JUMP_HINT_SHOW_DELAY_MS,
      onVisibilityChange: (visible) => {
        visibilityChanges.push(visible);
      },
    });

    controller.sync(true);
    vi.advanceTimersByTime(THREAD_JUMP_HINT_SHOW_DELAY_MS - 1);

    expect(visibilityChanges).toEqual([]);

    vi.advanceTimersByTime(1);

    expect(visibilityChanges).toEqual([true]);
  });

  it("hides immediately when the modifiers are released", () => {
    const visibilityChanges: boolean[] = [];
    const controller = createSessionJumpHintVisibilityController({
      delayMs: THREAD_JUMP_HINT_SHOW_DELAY_MS,
      onVisibilityChange: (visible) => {
        visibilityChanges.push(visible);
      },
    });

    controller.sync(true);
    vi.advanceTimersByTime(THREAD_JUMP_HINT_SHOW_DELAY_MS);
    controller.sync(false);

    expect(visibilityChanges).toEqual([true, false]);
  });

  it("cancels a pending reveal when the modifier is released early", () => {
    const visibilityChanges: boolean[] = [];
    const controller = createSessionJumpHintVisibilityController({
      delayMs: THREAD_JUMP_HINT_SHOW_DELAY_MS,
      onVisibilityChange: (visible) => {
        visibilityChanges.push(visible);
      },
    });

    controller.sync(true);
    vi.advanceTimersByTime(Math.floor(THREAD_JUMP_HINT_SHOW_DELAY_MS / 2));
    controller.sync(false);
    vi.advanceTimersByTime(THREAD_JUMP_HINT_SHOW_DELAY_MS);

    expect(visibilityChanges).toEqual([]);
  });
});

describe("getSidebarSessionIdsToPrewarm", () => {
  it("returns only the first visible session ids up to the prewarm limit", () => {
    expect(getSidebarSessionIdsToPrewarm(["t1", "t2", "t3"], 2)).toEqual(["t1", "t2"]);
  });

  it("returns all visible session ids when they fit within the limit", () => {
    expect(getSidebarSessionIdsToPrewarm(["t1", "t2"], 10)).toEqual(["t1", "t2"]);
  });

  it("returns no session ids when the limit is zero", () => {
    expect(getSidebarSessionIdsToPrewarm(["t1", "t2"], 0)).toEqual([]);
  });
});

describe("shouldClearSessionSelectionOnMouseDown", () => {
  it("preserves selection for session items", () => {
    const child = {
      closest: (selector: string) =>
        selector.includes("[data-session-item]") ? ({} as Element) : null,
    } as unknown as HTMLElement;

    expect(shouldClearSessionSelectionOnMouseDown(child)).toBe(false);
  });

  it("preserves selection for session list toggle controls", () => {
    const selectionSafe = {
      closest: (selector: string) =>
        selector.includes("[data-session-selection-safe]") ? ({} as Element) : null,
    } as unknown as HTMLElement;

    expect(shouldClearSessionSelectionOnMouseDown(selectionSafe)).toBe(false);
  });

  it("clears selection for unrelated sidebar clicks", () => {
    const unrelated = {
      closest: () => null,
    } as unknown as HTMLElement;

    expect(shouldClearSessionSelectionOnMouseDown(unrelated)).toBe(true);
  });
});

describe("resolveSidebarNewSessionEnvMode", () => {
  it("uses the app default when the caller does not request a specific mode", () => {
    expect(
      resolveSidebarNewSessionEnvMode({
        defaultEnvMode: "worktree",
      }),
    ).toBe("worktree");
  });

  it("preserves an explicit requested mode over the app default", () => {
    expect(
      resolveSidebarNewSessionEnvMode({
        requestedEnvMode: "local",
        defaultEnvMode: "worktree",
      }),
    ).toBe("local");
  });
});

describe("resolveSidebarNewSessionSeedContext", () => {
  it("prefers the default worktree mode over active session context", () => {
    expect(
      resolveSidebarNewSessionSeedContext({
        projectId: "project-1",
        defaultEnvMode: "worktree",
        activeSession: {
          projectId: "project-1",
          branch: "feature/existing",
          worktreePath: "/repo/.t3/worktrees/existing",
        },
        activeDraftSession: {
          projectId: "project-1",
          branch: "feature/draft",
          worktreePath: "/repo/.t3/worktrees/draft",
          envMode: "worktree",
        },
      }),
    ).toEqual({
      envMode: "worktree",
    });
  });

  it("inherits the active server session context when creating a new session in the same project", () => {
    expect(
      resolveSidebarNewSessionSeedContext({
        projectId: "project-1",
        defaultEnvMode: "local",
        activeSession: {
          projectId: "project-1",
          branch: "effect-atom",
          worktreePath: null,
        },
        activeDraftSession: null,
      }),
    ).toEqual({
      branch: "effect-atom",
      worktreePath: null,
      envMode: "local",
    });
  });

  it("prefers the active draft session context when it matches the target project", () => {
    expect(
      resolveSidebarNewSessionSeedContext({
        projectId: "project-1",
        defaultEnvMode: "local",
        activeSession: {
          projectId: "project-1",
          branch: "effect-atom",
          worktreePath: null,
        },
        activeDraftSession: {
          projectId: "project-1",
          branch: "feature/new-draft",
          worktreePath: "/repo/worktree",
          envMode: "worktree",
        },
      }),
    ).toEqual({
      branch: "feature/new-draft",
      worktreePath: "/repo/worktree",
      envMode: "worktree",
    });
  });

  it("falls back to the default env mode when there is no matching active session context", () => {
    expect(
      resolveSidebarNewSessionSeedContext({
        projectId: "project-2",
        defaultEnvMode: "worktree",
        activeSession: {
          projectId: "project-1",
          branch: "effect-atom",
          worktreePath: null,
        },
        activeDraftSession: null,
      }),
    ).toEqual({
      envMode: "worktree",
    });
  });
});

describe("orderItemsByPreferredIds", () => {
  it("keeps preferred ids first, skips stale ids, and preserves the relative order of remaining items", () => {
    const ordered = orderItemsByPreferredIds({
      items: [
        { id: ProjectId.make("project-1"), name: "One" },
        { id: ProjectId.make("project-2"), name: "Two" },
        { id: ProjectId.make("project-3"), name: "Three" },
      ],
      preferredIds: [
        ProjectId.make("project-3"),
        ProjectId.make("project-missing"),
        ProjectId.make("project-1"),
      ],
      getId: (project) => project.id,
    });

    expect(ordered.map((project) => project.id)).toEqual([
      ProjectId.make("project-3"),
      ProjectId.make("project-1"),
      ProjectId.make("project-2"),
    ]);
  });

  it("does not duplicate items when preferred ids repeat", () => {
    const ordered = orderItemsByPreferredIds({
      items: [
        { id: ProjectId.make("project-1"), name: "One" },
        { id: ProjectId.make("project-2"), name: "Two" },
      ],
      preferredIds: [
        ProjectId.make("project-2"),
        ProjectId.make("project-1"),
        ProjectId.make("project-2"),
      ],
      getId: (project) => project.id,
    });

    expect(ordered.map((project) => project.id)).toEqual([
      ProjectId.make("project-2"),
      ProjectId.make("project-1"),
    ]);
  });

  it("honors projectOrder physical keys via getProjectOrderKey", async () => {
    // Regression guard for #1904 / the regression introduced by #2055:
    // `projectOrder` is populated with physical keys (envId + cwd-derived)
    // by the store and by drag-end handlers. Readers must identify projects
    // with the same key format, or manual sort silently snaps back.
    const { getProjectOrderKey } = await import("../logicalProject");
    const projects = [
      {
        environmentId: EnvironmentId.make("environment-local"),
        id: ProjectId.make("id-alpha"),
        cwd: "/work/alpha",
      },
      {
        environmentId: EnvironmentId.make("environment-local"),
        id: ProjectId.make("id-beta"),
        cwd: "/work/beta",
      },
      {
        environmentId: EnvironmentId.make("environment-local"),
        id: ProjectId.make("id-gamma"),
        cwd: "/work/gamma",
      },
    ];
    const ordered = orderItemsByPreferredIds({
      items: projects,
      preferredIds: [getProjectOrderKey(projects[2]!), getProjectOrderKey(projects[0]!)],
      getId: getProjectOrderKey,
    });

    expect(ordered.map((project) => project.cwd)).toEqual([
      "/work/gamma",
      "/work/alpha",
      "/work/beta",
    ]);
  });
});

describe("resolveAdjacentSessionId", () => {
  it("resolves adjacent session ids in ordered sidebar traversal", () => {
    const sessions = [
      SessionId.make("session-1"),
      SessionId.make("session-2"),
      SessionId.make("session-3"),
    ];

    expect(
      resolveAdjacentSessionId({
        sessionIds: sessions,
        currentSessionId: sessions[1] ?? null,
        direction: "previous",
      }),
    ).toBe(sessions[0]);
    expect(
      resolveAdjacentSessionId({
        sessionIds: sessions,
        currentSessionId: sessions[1] ?? null,
        direction: "next",
      }),
    ).toBe(sessions[2]);
    expect(
      resolveAdjacentSessionId({
        sessionIds: sessions,
        currentSessionId: null,
        direction: "next",
      }),
    ).toBe(sessions[0]);
    expect(
      resolveAdjacentSessionId({
        sessionIds: sessions,
        currentSessionId: null,
        direction: "previous",
      }),
    ).toBe(sessions[2]);
    expect(
      resolveAdjacentSessionId({
        sessionIds: sessions,
        currentSessionId: sessions[0] ?? null,
        direction: "previous",
      }),
    ).toBeNull();
  });
});

describe("getVisibleSidebarSessionIds", () => {
  it("returns only the rendered visible session order across projects", () => {
    expect(
      getVisibleSidebarSessionIds([
        {
          renderedSessionIds: [
            SessionId.make("session-12"),
            SessionId.make("session-11"),
            SessionId.make("session-10"),
          ],
        },
        {
          renderedSessionIds: [SessionId.make("session-8"), SessionId.make("session-6")],
        },
      ]),
    ).toEqual([
      SessionId.make("session-12"),
      SessionId.make("session-11"),
      SessionId.make("session-10"),
      SessionId.make("session-8"),
      SessionId.make("session-6"),
    ]);
  });

  it("skips sessions from collapsed projects whose session panels are not shown", () => {
    expect(
      getVisibleSidebarSessionIds([
        {
          shouldShowSessionPanel: false,
          renderedSessionIds: [
            SessionId.make("session-hidden-2"),
            SessionId.make("session-hidden-1"),
          ],
        },
        {
          shouldShowSessionPanel: true,
          renderedSessionIds: [SessionId.make("session-12"), SessionId.make("session-11")],
        },
      ]),
    ).toEqual([SessionId.make("session-12"), SessionId.make("session-11")]);
  });
});

describe("isContextMenuPointerDown", () => {
  it("treats secondary-button presses as context menu gestures on all platforms", () => {
    expect(
      isContextMenuPointerDown({
        button: 2,
        ctrlKey: false,
        isMac: false,
      }),
    ).toBe(true);
  });

  it("treats ctrl+primary-click as a context menu gesture on macOS", () => {
    expect(
      isContextMenuPointerDown({
        button: 0,
        ctrlKey: true,
        isMac: true,
      }),
    ).toBe(true);
  });

  it("does not treat ctrl+primary-click as a context menu gesture off macOS", () => {
    expect(
      isContextMenuPointerDown({
        button: 0,
        ctrlKey: true,
        isMac: false,
      }),
    ).toBe(false);
  });
});

describe("resolveSessionStatusPill", () => {
  const baseSession = {
    hasActionableProposedPlan: false,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    interactionMode: "plan" as const,
    latestTurn: null,
    lastVisitedAt: undefined,
    session: {
      provider: ProviderDriverKind.make("codex"),
      status: "running" as const,
      createdAt: "2026-03-09T10:00:00.000Z",
      updatedAt: "2026-03-09T10:00:00.000Z",
      orchestrationStatus: "running" as const,
    },
  };

  it("shows pending approval before all other statuses", () => {
    expect(
      resolveSessionStatusPill({
        session: {
          ...baseSession,
          hasPendingApprovals: true,
          hasPendingUserInput: true,
        },
      }),
    ).toMatchObject({ label: "Pending Approval", pulse: false });
  });

  it("shows awaiting input when plan mode is blocked on user answers", () => {
    expect(
      resolveSessionStatusPill({
        session: {
          ...baseSession,
          hasPendingUserInput: true,
        },
      }),
    ).toMatchObject({ label: "Awaiting Input", pulse: false });
  });

  it("falls back to working when the session is actively running without blockers", () => {
    expect(
      resolveSessionStatusPill({
        session: baseSession,
      }),
    ).toMatchObject({ label: "Working", pulse: true });
  });

  it("shows plan ready when a settled plan turn has a proposed plan ready for follow-up", () => {
    expect(
      resolveSessionStatusPill({
        session: {
          ...baseSession,
          hasActionableProposedPlan: true,
          latestTurn: makeLatestTurn(),
          session: {
            ...baseSession.session,
            status: "ready",
            orchestrationStatus: "ready",
          },
        },
      }),
    ).toMatchObject({ label: "Plan Ready", pulse: false });
  });

  it("does not show plan ready after the proposed plan was implemented elsewhere", () => {
    expect(
      resolveSessionStatusPill({
        session: {
          ...baseSession,
          latestTurn: makeLatestTurn(),
          session: {
            ...baseSession.session,
            status: "ready",
            orchestrationStatus: "ready",
          },
        },
      }),
    ).toMatchObject({ label: "Completed", pulse: false });
  });

  it("shows completed when there is an unseen completion and no active blocker", () => {
    expect(
      resolveSessionStatusPill({
        session: {
          ...baseSession,
          interactionMode: "default",
          latestTurn: makeLatestTurn(),
          lastVisitedAt: "2026-03-09T10:04:00.000Z",
          session: {
            ...baseSession.session,
            status: "ready",
            orchestrationStatus: "ready",
          },
        },
      }),
    ).toMatchObject({ label: "Completed", pulse: false });
  });
});

describe("resolveSessionRowClassName", () => {
  it("uses the sidebar accent palette when a session is both selected and active", () => {
    const className = resolveSessionRowClassName({ isActive: true, isSelected: true });
    expect(className).toContain("bg-sidebar-accent");
    expect(className).toContain("hover:bg-sidebar-accent");
    expect(className).toContain("text-sidebar-accent-foreground");
    expect(className).not.toContain("bg-primary");
  });

  it("uses selected hover colors for selected sessions", () => {
    const className = resolveSessionRowClassName({ isActive: false, isSelected: true });
    expect(className).toContain("bg-sidebar-accent");
    expect(className).toContain("hover:bg-sidebar-accent");
    expect(className).not.toContain("bg-primary");
  });

  it("keeps the accent palette for active-only sessions", () => {
    const className = resolveSessionRowClassName({ isActive: true, isSelected: false });
    expect(className).toContain("bg-sidebar-accent");
    expect(className).toContain("hover:bg-sidebar-accent");
  });
});

describe("resolveProjectStatusIndicator", () => {
  it("returns null when no sessions have a notable status", () => {
    expect(resolveProjectStatusIndicator([null, null])).toBeNull();
  });

  it("surfaces the highest-priority actionable state across project sessions", () => {
    expect(
      resolveProjectStatusIndicator([
        {
          label: "Completed",
          colorClass: "text-zinc-600",
          dotClass: "bg-zinc-500",
          pulse: false,
        },
        {
          label: "Pending Approval",
          colorClass: "text-amber-600",
          dotClass: "bg-amber-500",
          pulse: false,
        },
        {
          label: "Working",
          colorClass: "text-sky-600",
          dotClass: "bg-sky-500",
          pulse: true,
        },
      ]),
    ).toMatchObject({ label: "Pending Approval", dotClass: "bg-amber-500" });
  });

  it("prefers plan-ready over completed when no stronger action is needed", () => {
    expect(
      resolveProjectStatusIndicator([
        {
          label: "Completed",
          colorClass: "text-zinc-600",
          dotClass: "bg-zinc-500",
          pulse: false,
        },
        {
          label: "Plan Ready",
          colorClass: "text-violet-600",
          dotClass: "bg-violet-500",
          pulse: false,
        },
      ]),
    ).toMatchObject({ label: "Plan Ready", dotClass: "bg-violet-500" });
  });
});

describe("getVisibleSessionsForProject", () => {
  it("includes the active session even when it falls below the folded preview", () => {
    const sessions = Array.from({ length: 8 }, (_, index) =>
      makeSession({
        id: SessionId.make(`session-${index + 1}`),
        title: `Session ${index + 1}`,
      }),
    );

    const result = getVisibleSessionsForProject({
      sessions,
      activeSessionId: SessionId.make("session-8"),
      isSessionListExpanded: false,
      previewLimit: 6,
    });

    expect(result.hasHiddenSessions).toBe(true);
    expect(result.visibleSessions.map((session) => session.id)).toEqual([
      SessionId.make("session-1"),
      SessionId.make("session-2"),
      SessionId.make("session-3"),
      SessionId.make("session-4"),
      SessionId.make("session-5"),
      SessionId.make("session-6"),
      SessionId.make("session-8"),
    ]);
    expect(result.hiddenSessions.map((session) => session.id)).toEqual([
      SessionId.make("session-7"),
    ]);
  });

  it("returns all sessions when the list is expanded", () => {
    const sessions = Array.from({ length: 8 }, (_, index) =>
      makeSession({
        id: SessionId.make(`session-${index + 1}`),
      }),
    );

    const result = getVisibleSessionsForProject({
      sessions,
      activeSessionId: SessionId.make("session-8"),
      isSessionListExpanded: true,
      previewLimit: 6,
    });

    expect(result.hasHiddenSessions).toBe(true);
    expect(result.visibleSessions.map((session) => session.id)).toEqual(
      sessions.map((session) => session.id),
    );
    expect(result.hiddenSessions).toEqual([]);
  });
});

function makeProject(overrides: Partial<Project> = {}): Project {
  const { defaultModelSelection, ...rest } = overrides;
  return {
    id: ProjectId.make("project-1"),
    environmentId: localEnvironmentId,
    name: "Project",
    cwd: "/tmp/project",
    defaultModelSelection: {
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-5.4",
      ...defaultModelSelection,
    },
    createdAt: "2026-03-09T10:00:00.000Z",
    updatedAt: "2026-03-09T10:00:00.000Z",
    scripts: [],
    ...rest,
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
      model: "gpt-5.4",
      ...overrides?.modelSelection,
    },
    runtimeMode: DEFAULT_RUNTIME_MODE,
    interactionMode: DEFAULT_INTERACTION_MODE,
    session: null,
    messages: [],
    proposedPlans: [],
    error: null,
    createdAt: "2026-03-09T10:00:00.000Z",
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    updatedAt: "2026-03-09T10:00:00.000Z",
    latestTurn: null,
    branch: null,
    worktreePath: null,
    turnDiffSummaries: [],
    activities: [],
    ...overrides,
  };
}

describe("getFallbackSessionIdAfterDelete", () => {
  it("returns the top remaining session in the deleted session's project sidebar order", () => {
    const fallbackSessionId = getFallbackSessionIdAfterDelete({
      sessions: [
        makeSession({
          id: SessionId.make("session-oldest"),
          projectId: ProjectId.make("project-1"),
          createdAt: "2026-03-09T10:00:00.000Z",
          messages: [],
        }),
        makeSession({
          id: SessionId.make("session-active"),
          projectId: ProjectId.make("project-1"),
          createdAt: "2026-03-09T10:05:00.000Z",
          messages: [],
        }),
        makeSession({
          id: SessionId.make("session-newest"),
          projectId: ProjectId.make("project-1"),
          createdAt: "2026-03-09T10:10:00.000Z",
          messages: [],
        }),
        makeSession({
          id: SessionId.make("session-other-project"),
          projectId: ProjectId.make("project-2"),
          createdAt: "2026-03-09T10:20:00.000Z",
          messages: [],
        }),
      ],
      deletedSessionId: SessionId.make("session-active"),
      sortOrder: "created_at",
    });

    expect(fallbackSessionId).toBe(SessionId.make("session-newest"));
  });

  it("skips other sessions being deleted in the same action", () => {
    const fallbackSessionId = getFallbackSessionIdAfterDelete({
      sessions: [
        makeSession({
          id: SessionId.make("session-active"),
          projectId: ProjectId.make("project-1"),
          createdAt: "2026-03-09T10:05:00.000Z",
          messages: [],
        }),
        makeSession({
          id: SessionId.make("session-newest"),
          projectId: ProjectId.make("project-1"),
          createdAt: "2026-03-09T10:10:00.000Z",
          messages: [],
        }),
        makeSession({
          id: SessionId.make("session-next"),
          projectId: ProjectId.make("project-1"),
          createdAt: "2026-03-09T10:07:00.000Z",
          messages: [],
        }),
      ],
      deletedSessionId: SessionId.make("session-active"),
      deletedSessionIds: new Set([
        SessionId.make("session-active"),
        SessionId.make("session-newest"),
      ]),
      sortOrder: "created_at",
    });

    expect(fallbackSessionId).toBe(SessionId.make("session-next"));
  });
});
describe("sortProjectsForSidebar", () => {
  it("sorts projects by the most recent user message across their sessions", () => {
    const projects = [
      makeProject({ id: ProjectId.make("project-1"), name: "Older project" }),
      makeProject({ id: ProjectId.make("project-2"), name: "Newer project" }),
    ];
    const sessions = [
      makeSession({
        projectId: ProjectId.make("project-1"),
        updatedAt: "2026-03-09T10:20:00.000Z",
        messages: [
          {
            id: "message-1" as never,
            role: "user",
            text: "older project user message",
            createdAt: "2026-03-09T10:01:00.000Z",
            streaming: false,
            completedAt: "2026-03-09T10:01:00.000Z",
          },
        ],
      }),
      makeSession({
        id: SessionId.make("session-2"),
        projectId: ProjectId.make("project-2"),
        updatedAt: "2026-03-09T10:05:00.000Z",
        messages: [
          {
            id: "message-2" as never,
            role: "user",
            text: "newer project user message",
            createdAt: "2026-03-09T10:05:00.000Z",
            streaming: false,
            completedAt: "2026-03-09T10:05:00.000Z",
          },
        ],
      }),
    ];

    const sorted = sortProjectsForSidebar(projects, sessions, "updated_at");

    expect(sorted.map((project) => project.id)).toEqual([
      ProjectId.make("project-2"),
      ProjectId.make("project-1"),
    ]);
  });

  it("falls back to project timestamps when a project has no sessions", () => {
    const sorted = sortProjectsForSidebar(
      [
        makeProject({
          id: ProjectId.make("project-1"),
          name: "Older project",
          updatedAt: "2026-03-09T10:01:00.000Z",
        }),
        makeProject({
          id: ProjectId.make("project-2"),
          name: "Newer project",
          updatedAt: "2026-03-09T10:05:00.000Z",
        }),
      ],
      [],
      "updated_at",
    );

    expect(sorted.map((project) => project.id)).toEqual([
      ProjectId.make("project-2"),
      ProjectId.make("project-1"),
    ]);
  });

  it("falls back to name and id ordering when projects have no sortable timestamps", () => {
    const sorted = sortProjectsForSidebar(
      [
        makeProject({
          id: ProjectId.make("project-2"),
          name: "Beta",
          createdAt: undefined,
          updatedAt: undefined,
        }),
        makeProject({
          id: ProjectId.make("project-1"),
          name: "Alpha",
          createdAt: undefined,
          updatedAt: undefined,
        }),
      ],
      [],
      "updated_at",
    );

    expect(sorted.map((project) => project.id)).toEqual([
      ProjectId.make("project-1"),
      ProjectId.make("project-2"),
    ]);
  });

  it("preserves manual project ordering", () => {
    const projects = [
      makeProject({ id: ProjectId.make("project-2"), name: "Second" }),
      makeProject({ id: ProjectId.make("project-1"), name: "First" }),
    ];

    const sorted = sortProjectsForSidebar(projects, [], "manual");

    expect(sorted.map((project) => project.id)).toEqual([
      ProjectId.make("project-2"),
      ProjectId.make("project-1"),
    ]);
  });

  it("ignores archived sessions when sorting projects", () => {
    const sorted = sortProjectsForSidebar(
      [
        makeProject({
          id: ProjectId.make("project-1"),
          name: "Visible project",
          updatedAt: "2026-03-09T10:01:00.000Z",
        }),
        makeProject({
          id: ProjectId.make("project-2"),
          name: "Archived-only project",
          updatedAt: "2026-03-09T10:00:00.000Z",
        }),
      ],
      [
        makeSession({
          id: SessionId.make("session-visible"),
          projectId: ProjectId.make("project-1"),
          updatedAt: "2026-03-09T10:02:00.000Z",
          archivedAt: null,
        }),
        makeSession({
          id: SessionId.make("session-archived"),
          projectId: ProjectId.make("project-2"),
          updatedAt: "2026-03-09T10:10:00.000Z",
          archivedAt: "2026-03-09T10:11:00.000Z",
        }),
      ].filter((session) => session.archivedAt === null),
      "updated_at",
    );

    expect(sorted.map((project) => project.id)).toEqual([
      ProjectId.make("project-1"),
      ProjectId.make("project-2"),
    ]);
  });

  it("returns the project timestamp when no sessions are present", () => {
    const timestamp = getProjectSortTimestamp(
      makeProject({ updatedAt: "2026-03-09T10:10:00.000Z" }),
      [],
      "updated_at",
    );

    expect(timestamp).toBe(Date.parse("2026-03-09T10:10:00.000Z"));
  });
});
