import {
  CheckpointRef,
  EventId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  SessionId,
  TurnId,
  type OrchestrationEvent,
} from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import { deriveOrchestrationBatchEffects } from "./orchestrationEventEffects";

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

describe("deriveOrchestrationBatchEffects", () => {
  it("targets draft promotion and terminal cleanup from session lifecycle events", () => {
    const createdSessionId = SessionId.make("session-created");
    const deletedSessionId = SessionId.make("session-deleted");
    const archivedSessionId = SessionId.make("session-archived");

    const effects = deriveOrchestrationBatchEffects([
      makeEvent("session.created", {
        sessionId: createdSessionId,
        projectId: ProjectId.make("project-1"),
        title: "Created session",
        modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5-codex" },
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        createdAt: "2026-02-27T00:00:00.000Z",
        updatedAt: "2026-02-27T00:00:00.000Z",
      }),
      makeEvent("session.deleted", {
        sessionId: deletedSessionId,
        deletedAt: "2026-02-27T00:00:01.000Z",
      }),
      makeEvent("session.archived", {
        sessionId: archivedSessionId,
        archivedAt: "2026-02-27T00:00:02.000Z",
        updatedAt: "2026-02-27T00:00:02.000Z",
      }),
    ]);

    expect(effects.promoteDraftSessionIds).toEqual([createdSessionId]);
    expect(effects.clearDeletedSessionIds).toEqual([deletedSessionId]);
    expect(effects.removeTerminalStateSessionIds).toEqual([deletedSessionId, archivedSessionId]);
    expect(effects.needsProviderInvalidation).toBe(false);
  });

  it("keeps only the final lifecycle outcome for a session within one batch", () => {
    const sessionId = SessionId.make("session-1");

    const effects = deriveOrchestrationBatchEffects([
      makeEvent("session.deleted", {
        sessionId,
        deletedAt: "2026-02-27T00:00:01.000Z",
      }),
      makeEvent("session.created", {
        sessionId,
        projectId: ProjectId.make("project-1"),
        title: "Recreated session",
        modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5-codex" },
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        createdAt: "2026-02-27T00:00:02.000Z",
        updatedAt: "2026-02-27T00:00:02.000Z",
      }),
      makeEvent("session.turn-diff-completed", {
        sessionId,
        turnId: TurnId.make("turn-1"),
        checkpointTurnCount: 1,
        checkpointRef: CheckpointRef.make("checkpoint-1"),
        status: "ready",
        files: [],
        assistantMessageId: MessageId.make("assistant-1"),
        completedAt: "2026-02-27T00:00:03.000Z",
      }),
    ]);

    expect(effects.promoteDraftSessionIds).toEqual([sessionId]);
    expect(effects.clearDeletedSessionIds).toEqual([]);
    expect(effects.removeTerminalStateSessionIds).toEqual([]);
    expect(effects.needsProviderInvalidation).toBe(true);
  });

  it("does not retain archive cleanup when a session is unarchived later in the same batch", () => {
    const sessionId = SessionId.make("session-1");

    const effects = deriveOrchestrationBatchEffects([
      makeEvent("session.archived", {
        sessionId,
        archivedAt: "2026-02-27T00:00:01.000Z",
        updatedAt: "2026-02-27T00:00:01.000Z",
      }),
      makeEvent("session.unarchived", {
        sessionId,
        updatedAt: "2026-02-27T00:00:02.000Z",
      }),
    ]);

    expect(effects.promoteDraftSessionIds).toEqual([]);
    expect(effects.clearDeletedSessionIds).toEqual([]);
    expect(effects.removeTerminalStateSessionIds).toEqual([]);
  });
});
