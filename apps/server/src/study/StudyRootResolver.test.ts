import {
  ProjectId,
  ProviderInstanceId,
  SessionId,
  type OrchestrationProjectShell,
  type OrchestrationSessionShell,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { describe, expect, it } from "vitest";

import type { ProjectionSnapshotQueryShape } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { resolveStudyRootForProject, resolveStudyRootForSession } from "./StudyRootResolver.ts";

const timestamp = "2026-06-01T00:00:00.000Z";
const projectId = ProjectId.make("project-1");
const sessionId = SessionId.make("session-1");

const makeProject = (
  overrides: Partial<OrchestrationProjectShell> = {},
): OrchestrationProjectShell => ({
  id: projectId,
  title: "Project",
  workspaceRoot: "/repo/project",
  defaultModelSelection: null,
  scripts: [],
  createdAt: timestamp,
  updatedAt: timestamp,
  ...overrides,
});

const makeSession = (
  overrides: Partial<OrchestrationSessionShell> = {},
): OrchestrationSessionShell => ({
  id: sessionId,
  projectId,
  title: "Session",
  modelSelection: {
    instanceId: ProviderInstanceId.make("codex"),
    model: "gpt-5.4",
  },
  runtimeMode: "full-access",
  interactionMode: "default",
  workflowId: null,
  workflowVersion: null,
  branch: null,
  worktreePath: null,
  latestTurn: null,
  createdAt: timestamp,
  updatedAt: timestamp,
  archivedAt: null,
  session: null,
  latestUserMessageAt: null,
  hasPendingApprovals: false,
  hasPendingUserInput: false,
  hasActionableProposedPlan: false,
  ...overrides,
});

const makeProjectionQuery = (input: {
  readonly project?: OrchestrationProjectShell;
  readonly session?: OrchestrationSessionShell;
}): ProjectionSnapshotQueryShape => ({
  getCommandReadModel: () => Effect.die("unused"),
  getSnapshot: () => Effect.die("unused"),
  getShellSnapshot: () => Effect.die("unused"),
  getArchivedShellSnapshot: () => Effect.die("unused"),
  getSnapshotSequence: () => Effect.die("unused"),
  getCounts: () => Effect.die("unused"),
  getActiveProjectByWorkspaceRoot: () => Effect.die("unused"),
  getProjectShellById: (id) =>
    Effect.succeed(
      input.project && input.project.id === id ? Option.some(input.project) : Option.none(),
    ),
  getFirstActiveSessionIdByProjectId: () => Effect.die("unused"),
  getSessionCheckpointContext: () => Effect.die("unused"),
  getFullSessionDiffContext: () => Effect.die("unused"),
  getSessionShellById: (id) =>
    Effect.succeed(
      input.session && input.session.id === id ? Option.some(input.session) : Option.none(),
    ),
  getSessionDetailById: () => Effect.die("unused"),
  getResearchCardDetail: () => Effect.die("unused"),
});

describe("StudyRootResolver", () => {
  it("resolves active projects to their workspace root", async () => {
    const query = makeProjectionQuery({ project: makeProject() });

    await expect(Effect.runPromise(resolveStudyRootForProject(query, projectId))).resolves.toBe(
      "/repo/project",
    );
  });

  it("resolves sessions to their worktree when present", async () => {
    const query = makeProjectionQuery({
      project: makeProject(),
      session: makeSession({ worktreePath: "/repo/worktrees/session-1" }),
    });

    await expect(Effect.runPromise(resolveStudyRootForSession(query, sessionId))).resolves.toBe(
      "/repo/worktrees/session-1",
    );
  });

  it("falls back from sessions to the active project root", async () => {
    const query = makeProjectionQuery({
      project: makeProject(),
      session: makeSession(),
    });

    await expect(Effect.runPromise(resolveStudyRootForSession(query, sessionId))).resolves.toBe(
      "/repo/project",
    );
  });

  it("fails cleanly for unknown or deleted sessions", async () => {
    const query = makeProjectionQuery({ project: makeProject() });

    await expect(Effect.runPromise(resolveStudyRootForSession(query, sessionId))).rejects.toThrow(
      "Unknown or deleted session: session-1.",
    );
  });

  it("fails cleanly when a session's project is unknown or deleted", async () => {
    const query = makeProjectionQuery({ session: makeSession() });

    await expect(Effect.runPromise(resolveStudyRootForSession(query, sessionId))).rejects.toThrow(
      "Unknown or deleted project: project-1.",
    );
  });
});
