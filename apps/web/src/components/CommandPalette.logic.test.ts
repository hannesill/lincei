import { describe, expect, it, vi } from "vitest";
import { EnvironmentId, ProjectId, ProviderInstanceId, SessionId } from "@t3tools/contracts";
import type { Session } from "../types";
import {
  buildSessionActionItems,
  filterCommandPaletteGroups,
  type CommandPaletteGroup,
} from "./CommandPalette.logic";

const LOCAL_ENVIRONMENT_ID = EnvironmentId.make("environment-local");
const PROJECT_ID = ProjectId.make("project-1");

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: SessionId.make("session-1"),
    environmentId: LOCAL_ENVIRONMENT_ID,
    codexSessionId: null,
    projectId: PROJECT_ID,
    title: "Session",
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5" },
    runtimeMode: "full-access",
    interactionMode: "default",
    session: null,
    messages: [],
    proposedPlans: [],
    error: null,
    createdAt: "2026-03-01T00:00:00.000Z",
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    updatedAt: "2026-03-01T00:00:00.000Z",
    latestTurn: null,
    branch: null,
    worktreePath: null,
    turnDiffSummaries: [],
    activities: [],
    ...overrides,
  };
}

describe("buildSessionActionItems", () => {
  it("orders sessions by most recent activity and formats timestamps from updatedAt", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-25T12:00:00.000Z"));

    try {
      const items = buildSessionActionItems({
        sessions: [
          makeSession({
            id: SessionId.make("session-older"),
            title: "Older session",
            updatedAt: "2026-03-24T12:00:00.000Z",
          }),
          makeSession({
            id: SessionId.make("session-newer"),
            title: "Newer session",
            createdAt: "2026-03-20T00:00:00.000Z",
            updatedAt: "2026-03-20T00:00:00.000Z",
          }),
        ],
        projectTitleById: new Map([[PROJECT_ID, "Project"]]),
        sortOrder: "updated_at",
        icon: null,
        runSession: async (_session) => undefined,
      });

      expect(items.map((item) => item.value)).toEqual([
        "session:session-older",
        "session:session-newer",
      ]);
      expect(items[0]?.timestamp).toBe("1d ago");
      expect(items[1]?.timestamp).toBe("5d ago");
    } finally {
      vi.useRealTimers();
    }
  });

  it("ranks session title matches ahead of contextual project-name matches", () => {
    const sessionItems = buildSessionActionItems({
      sessions: [
        makeSession({
          id: SessionId.make("session-context-match"),
          title: "Fix navbar spacing",
          updatedAt: "2026-03-20T00:00:00.000Z",
        }),
        makeSession({
          id: SessionId.make("session-title-match"),
          title: "Project kickoff notes",
          createdAt: "2026-03-02T00:00:00.000Z",
          updatedAt: "2026-03-19T00:00:00.000Z",
        }),
      ],
      projectTitleById: new Map([[PROJECT_ID, "Project"]]),
      sortOrder: "updated_at",
      icon: null,
      runSession: async (_session) => undefined,
    });

    const groups = filterCommandPaletteGroups({
      activeGroups: [],
      query: "project",
      isInSubmenu: false,
      projectSearchItems: [],
      sessionSearchItems: sessionItems,
    });

    expect(groups).toHaveLength(1);
    expect(groups[0]?.value).toBe("sessions-search");
    expect(groups[0]?.items.map((item) => item.value)).toEqual([
      "session:session-title-match",
      "session:session-context-match",
    ]);
  });

  it("preserves session project-name matches when there is no stronger title match", () => {
    const group: CommandPaletteGroup = {
      value: "sessions-search",
      label: "Sessions",
      items: [
        {
          kind: "action",
          value: "session:project-context-only",
          searchTerms: ["Fix navbar spacing", "Project"],
          title: "Fix navbar spacing",
          description: "Project",
          icon: null,
          run: async () => undefined,
        },
      ],
    };

    const groups = filterCommandPaletteGroups({
      activeGroups: [group],
      query: "project",
      isInSubmenu: false,
      projectSearchItems: [],
      sessionSearchItems: [],
    });

    expect(groups).toHaveLength(1);
    expect(groups[0]?.items.map((item) => item.value)).toEqual(["session:project-context-only"]);
  });

  it("filters archived sessions out of session search items", () => {
    const items = buildSessionActionItems({
      sessions: [
        makeSession({
          id: SessionId.make("session-active"),
          title: "Active session",
          createdAt: "2026-03-02T00:00:00.000Z",
          updatedAt: "2026-03-19T00:00:00.000Z",
        }),
        makeSession({
          id: SessionId.make("session-archived"),
          title: "Archived session",
          archivedAt: "2026-03-20T00:00:00.000Z",
          updatedAt: "2026-03-20T00:00:00.000Z",
        }),
      ],
      projectTitleById: new Map([[PROJECT_ID, "Project"]]),
      sortOrder: "updated_at",
      icon: null,
      runSession: async (_session) => undefined,
    });

    expect(items.map((item) => item.value)).toEqual(["session:session-active"]);
  });
});
