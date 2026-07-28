import { scopeProjectRef } from "@t3tools/client-runtime";
import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vitest";
import {
  resolveSessionActionProjectRef,
  startNewLocalSessionFromContext,
  startNewSessionFromContext,
  type ChatSessionActionContext,
} from "./chatSessionActions";

const ENVIRONMENT_ID = EnvironmentId.make("environment-1");
const PROJECT_ID = ProjectId.make("project-1");
const FALLBACK_PROJECT_ID = ProjectId.make("project-2");

function createContext(
  overrides: Partial<ChatSessionActionContext> = {},
): ChatSessionActionContext {
  return {
    activeDraftSession: null,
    activeSession: undefined,
    defaultProjectRef: scopeProjectRef(ENVIRONMENT_ID, FALLBACK_PROJECT_ID),
    defaultSessionEnvMode: "local",
    handleNewSession: async () => {},
    ...overrides,
  };
}

describe("chatSessionActions", () => {
  it("prefers the active draft session project when resolving session actions", () => {
    const projectRef = resolveSessionActionProjectRef(
      createContext({
        activeDraftSession: {
          environmentId: ENVIRONMENT_ID,
          projectId: PROJECT_ID,
          branch: "feature/refactor",
          worktreePath: "/tmp/worktree",
          envMode: "worktree",
        },
      }),
    );

    expect(projectRef).toEqual(scopeProjectRef(ENVIRONMENT_ID, PROJECT_ID));
  });

  it("falls back to the default project ref when there is no active session context", () => {
    const projectRef = resolveSessionActionProjectRef(
      createContext({
        defaultProjectRef: scopeProjectRef(ENVIRONMENT_ID, PROJECT_ID),
      }),
    );

    expect(projectRef).toEqual(scopeProjectRef(ENVIRONMENT_ID, PROJECT_ID));
  });

  it("keeps the project but resets workspace context for a new session", async () => {
    const handleNewSession = vi.fn<ChatSessionActionContext["handleNewSession"]>(async () => {});

    const didStart = await startNewSessionFromContext(
      createContext({
        activeDraftSession: {
          environmentId: ENVIRONMENT_ID,
          projectId: PROJECT_ID,
          branch: "feature/refactor",
          worktreePath: "/tmp/worktree",
          envMode: "worktree",
        },
        handleNewSession,
      }),
    );

    expect(didStart).toBe(true);
    expect(handleNewSession).toHaveBeenCalledWith(scopeProjectRef(ENVIRONMENT_ID, PROJECT_ID), {
      branch: null,
      worktreePath: null,
      envMode: "local",
    });
  });

  it("starts a local session with the configured default env mode", async () => {
    const handleNewSession = vi.fn<ChatSessionActionContext["handleNewSession"]>(async () => {});

    const didStart = await startNewLocalSessionFromContext(
      createContext({
        defaultProjectRef: scopeProjectRef(ENVIRONMENT_ID, PROJECT_ID),
        defaultSessionEnvMode: "worktree",
        handleNewSession,
      }),
    );

    expect(didStart).toBe(true);
    expect(handleNewSession).toHaveBeenCalledWith(scopeProjectRef(ENVIRONMENT_ID, PROJECT_ID), {
      branch: null,
      worktreePath: null,
      envMode: "worktree",
    });
  });

  it("does not start a session when there is no project context", async () => {
    const handleNewSession = vi.fn<ChatSessionActionContext["handleNewSession"]>(async () => {});

    const didStart = await startNewSessionFromContext(
      createContext({
        defaultProjectRef: null,
        handleNewSession,
      }),
    );

    expect(didStart).toBe(false);
    expect(handleNewSession).not.toHaveBeenCalled();
  });
});
