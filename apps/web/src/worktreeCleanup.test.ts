import { EnvironmentId, ProjectId, ProviderInstanceId, SessionId } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import { DEFAULT_INTERACTION_MODE, DEFAULT_RUNTIME_MODE, type Session } from "./types";
import { formatWorktreePathForDisplay, getOrphanedWorktreePathForSession } from "./worktreeCleanup";

const localEnvironmentId = EnvironmentId.make("environment-local");

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: SessionId.make("session-1"),
    environmentId: localEnvironmentId,
    codexSessionId: null,
    projectId: ProjectId.make("project-1"),
    title: "Session",
    modelSelection: {
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-5.3-codex",
    },
    runtimeMode: DEFAULT_RUNTIME_MODE,
    interactionMode: DEFAULT_INTERACTION_MODE,
    session: null,
    messages: [],
    turnDiffSummaries: [],
    activities: [],
    proposedPlans: [],
    error: null,
    createdAt: "2026-02-13T00:00:00.000Z",
    archivedAt: null,
    latestTurn: null,
    branch: null,
    worktreePath: null,
    ...overrides,
  };
}

describe("getOrphanedWorktreePathForSession", () => {
  it("returns null when the target session does not exist", () => {
    const result = getOrphanedWorktreePathForSession([], SessionId.make("missing-session"));
    expect(result).toBeNull();
  });

  it("returns null when the target session has no worktree", () => {
    const sessions = [makeSession()];
    const result = getOrphanedWorktreePathForSession(sessions, SessionId.make("session-1"));
    expect(result).toBeNull();
  });

  it("returns the path when no other session links to that worktree", () => {
    const sessions = [makeSession({ worktreePath: "/tmp/repo/worktrees/feature-a" })];
    const result = getOrphanedWorktreePathForSession(sessions, SessionId.make("session-1"));
    expect(result).toBe("/tmp/repo/worktrees/feature-a");
  });

  it("returns null when another session links to the same worktree", () => {
    const sessions = [
      makeSession({
        id: SessionId.make("session-1"),
        worktreePath: "/tmp/repo/worktrees/feature-a",
      }),
      makeSession({
        id: SessionId.make("session-2"),
        worktreePath: "/tmp/repo/worktrees/feature-a",
      }),
    ];
    const result = getOrphanedWorktreePathForSession(sessions, SessionId.make("session-1"));
    expect(result).toBeNull();
  });

  it("ignores sessions linked to different worktrees", () => {
    const sessions = [
      makeSession({
        id: SessionId.make("session-1"),
        worktreePath: "/tmp/repo/worktrees/feature-a",
      }),
      makeSession({
        id: SessionId.make("session-2"),
        worktreePath: "/tmp/repo/worktrees/feature-b",
      }),
    ];
    const result = getOrphanedWorktreePathForSession(sessions, SessionId.make("session-1"));
    expect(result).toBe("/tmp/repo/worktrees/feature-a");
  });
});

describe("formatWorktreePathForDisplay", () => {
  it("shows only the last path segment for unix-like paths", () => {
    const result = formatWorktreePathForDisplay(
      "/Users/julius/.t3/worktrees/t3code-mvp/t3code-4e609bb8",
    );
    expect(result).toBe("t3code-4e609bb8");
  });

  it("normalizes windows separators before selecting the final segment", () => {
    const result = formatWorktreePathForDisplay(
      "C:\\Users\\julius\\.t3\\worktrees\\t3code-mvp\\t3code-4e609bb8",
    );
    expect(result).toBe("t3code-4e609bb8");
  });

  it("uses the final segment even when outside ~/.t3/worktrees", () => {
    const result = formatWorktreePathForDisplay("/tmp/custom-worktrees/my-worktree");
    expect(result).toBe("my-worktree");
  });

  it("ignores trailing slashes", () => {
    const result = formatWorktreePathForDisplay("/tmp/custom-worktrees/my-worktree/");
    expect(result).toBe("my-worktree");
  });
});
