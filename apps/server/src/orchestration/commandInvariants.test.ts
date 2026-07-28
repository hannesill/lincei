import { describe, expect, it } from "vitest";
import {
  MessageId,
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  ProjectId,
  SessionId,
  type OrchestrationCommand,
  type OrchestrationReadModel,
  ProviderInstanceId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import {
  findSessionById,
  listSessionsByProjectId,
  requireNonNegativeInteger,
  requireSession,
  requireSessionAbsent,
} from "./commandInvariants.ts";

const now = "2026-01-01T00:00:00.000Z";

const readModel: OrchestrationReadModel = {
  snapshotSequence: 2,
  updatedAt: now,
  projects: [
    {
      id: ProjectId.make("project-a"),
      title: "Project A",
      workspaceRoot: "/tmp/project-a",
      defaultModelSelection: {
        instanceId: ProviderInstanceId.make("codex"),
        model: "gpt-5-codex",
      },
      scripts: [],
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    },
    {
      id: ProjectId.make("project-b"),
      title: "Project B",
      workspaceRoot: "/tmp/project-b",
      defaultModelSelection: {
        instanceId: ProviderInstanceId.make("codex"),
        model: "gpt-5-codex",
      },
      scripts: [],
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    },
  ],
  sessions: [
    {
      id: SessionId.make("session-1"),
      projectId: ProjectId.make("project-a"),
      title: "Session A",
      modelSelection: {
        instanceId: ProviderInstanceId.make("codex"),
        model: "gpt-5-codex",
      },
      interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
      runtimeMode: "full-access",
      workflowId: null,
      workflowVersion: null,
      branch: null,
      worktreePath: null,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
      settledOverride: null,
      settledAt: null,
      snoozedUntil: null,
      snoozedAt: null,
      latestTurn: null,
      messages: [],
      session: null,
      activities: [],
      proposedPlans: [],
      checkpoints: [],
      deletedAt: null,
    },
    {
      id: SessionId.make("session-2"),
      projectId: ProjectId.make("project-b"),
      title: "Session B",
      modelSelection: {
        instanceId: ProviderInstanceId.make("codex"),
        model: "gpt-5-codex",
      },
      interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
      runtimeMode: "full-access",
      workflowId: null,
      workflowVersion: null,
      branch: null,
      worktreePath: null,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
      settledOverride: null,
      settledAt: null,
      snoozedUntil: null,
      snoozedAt: null,
      latestTurn: null,
      messages: [],
      session: null,
      activities: [],
      proposedPlans: [],
      checkpoints: [],
      deletedAt: null,
    },
  ],
};

const messageSendCommand: OrchestrationCommand = {
  type: "session.turn.start",
  commandId: CommandId.make("cmd-1"),
  sessionId: SessionId.make("session-1"),
  message: {
    messageId: MessageId.make("msg-1"),
    role: "user",
    text: "hello",
    attachments: [],
  },
  interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
  runtimeMode: "approval-required",
  createdAt: now,
};

describe("commandInvariants", () => {
  it("finds sessions by id and project", () => {
    expect(findSessionById(readModel, SessionId.make("session-1"))?.projectId).toBe("project-a");
    expect(findSessionById(readModel, SessionId.make("missing"))).toBeUndefined();
    expect(
      listSessionsByProjectId(readModel, ProjectId.make("project-b")).map((session) => session.id),
    ).toEqual([SessionId.make("session-2")]);
  });

  it("requires existing session", async () => {
    const session = await Effect.runPromise(
      requireSession({
        readModel,
        command: messageSendCommand,
        sessionId: SessionId.make("session-1"),
      }),
    );
    expect(session.id).toBe(SessionId.make("session-1"));

    await expect(
      Effect.runPromise(
        requireSession({
          readModel,
          command: messageSendCommand,
          sessionId: SessionId.make("missing"),
        }),
      ),
    ).rejects.toThrow("does not exist");
  });

  it("requires missing session for create flows", async () => {
    await Effect.runPromise(
      requireSessionAbsent({
        readModel,
        command: {
          type: "session.create",
          commandId: CommandId.make("cmd-2"),
          sessionId: SessionId.make("session-3"),
          projectId: ProjectId.make("project-a"),
          title: "new",
          modelSelection: {
            instanceId: ProviderInstanceId.make("codex"),
            model: "gpt-5-codex",
          },
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          runtimeMode: "full-access",
          branch: null,
          worktreePath: null,
          createdAt: now,
        },
        sessionId: SessionId.make("session-3"),
      }),
    );

    await expect(
      Effect.runPromise(
        requireSessionAbsent({
          readModel,
          command: {
            type: "session.create",
            commandId: CommandId.make("cmd-3"),
            sessionId: SessionId.make("session-1"),
            projectId: ProjectId.make("project-a"),
            title: "dup",
            modelSelection: {
              instanceId: ProviderInstanceId.make("codex"),
              model: "gpt-5-codex",
            },
            interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
            runtimeMode: "full-access",
            branch: null,
            worktreePath: null,
            createdAt: now,
          },
          sessionId: SessionId.make("session-1"),
        }),
      ),
    ).rejects.toThrow("already exists");
  });

  it("requires non-negative integers", async () => {
    await Effect.runPromise(
      requireNonNegativeInteger({
        commandType: "session.checkpoint.revert",
        field: "turnCount",
        value: 0,
      }),
    );

    await expect(
      Effect.runPromise(
        requireNonNegativeInteger({
          commandType: "session.checkpoint.revert",
          field: "turnCount",
          value: -1,
        }),
      ),
    ).rejects.toThrow("greater than or equal to 0");
  });
});
