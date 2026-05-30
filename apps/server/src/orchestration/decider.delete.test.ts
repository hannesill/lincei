import {
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  EventId,
  ProjectId,
  SessionId,
  type OrchestrationCommand,
  type OrchestrationEvent,
  type OrchestrationReadModel,
  ProviderInstanceId,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import { describe, expect, it } from "vitest";

import { decideOrchestrationCommand } from "./decider.ts";
import { createEmptyReadModel, projectEvent } from "./projector.ts";

const asCommandId = (value: string): CommandId => CommandId.make(value);
const asEventId = (value: string): EventId => EventId.make(value);
const asProjectId = (value: string): ProjectId => ProjectId.make(value);
const asSessionId = (value: string): SessionId => SessionId.make(value);

async function seedReadModel(): Promise<OrchestrationReadModel> {
  const now = "2026-01-01T00:00:00.000Z";
  const initial = createEmptyReadModel(now);
  const withProject = await Effect.runPromise(
    projectEvent(initial, {
      sequence: 1,
      eventId: asEventId("evt-project-create"),
      aggregateKind: "project",
      aggregateId: asProjectId("project-delete"),
      type: "project.created",
      occurredAt: now,
      commandId: asCommandId("cmd-project-create"),
      causationEventId: null,
      correlationId: asCommandId("cmd-project-create"),
      metadata: {},
      payload: {
        projectId: asProjectId("project-delete"),
        title: "Project Delete",
        workspaceRoot: "/tmp/project-delete",
        defaultModelSelection: null,
        scripts: [],
        createdAt: now,
        updatedAt: now,
      },
    }),
  );

  const withFirstSession = await Effect.runPromise(
    projectEvent(withProject, {
      sequence: 2,
      eventId: asEventId("evt-session-create-1"),
      aggregateKind: "session",
      aggregateId: asSessionId("session-delete-1"),
      type: "session.created",
      occurredAt: now,
      commandId: asCommandId("cmd-session-create-1"),
      causationEventId: null,
      correlationId: asCommandId("cmd-session-create-1"),
      metadata: {},
      payload: {
        sessionId: asSessionId("session-delete-1"),
        projectId: asProjectId("project-delete"),
        title: "Session Delete 1",
        modelSelection: {
          instanceId: ProviderInstanceId.make("codex"),
          model: "gpt-5-codex",
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        branch: null,
        worktreePath: null,
        createdAt: now,
        updatedAt: now,
      },
    }),
  );

  return Effect.runPromise(
    projectEvent(withFirstSession, {
      sequence: 3,
      eventId: asEventId("evt-session-create-2"),
      aggregateKind: "session",
      aggregateId: asSessionId("session-delete-2"),
      type: "session.created",
      occurredAt: now,
      commandId: asCommandId("cmd-session-create-2"),
      causationEventId: null,
      correlationId: asCommandId("cmd-session-create-2"),
      metadata: {},
      payload: {
        sessionId: asSessionId("session-delete-2"),
        projectId: asProjectId("project-delete"),
        title: "Session Delete 2",
        modelSelection: {
          instanceId: ProviderInstanceId.make("codex"),
          model: "gpt-5-codex",
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        branch: null,
        worktreePath: null,
        createdAt: now,
        updatedAt: now,
      },
    }),
  );
}

type PlannedEvent = Omit<OrchestrationEvent, "sequence">;

function normalizeDeleteEvent(event: PlannedEvent | ReadonlyArray<PlannedEvent>) {
  const events = Array.isArray(event) ? event : [event];
  return events.map((entry) => {
    switch (entry.type) {
      case "session.deleted":
        return {
          type: entry.type,
          aggregateKind: entry.aggregateKind,
          aggregateId: entry.aggregateId,
          commandId: entry.commandId,
          correlationId: entry.correlationId,
          payload: {
            sessionId: entry.payload.sessionId,
          },
        };
      case "project.deleted":
        return {
          type: entry.type,
          aggregateKind: entry.aggregateKind,
          aggregateId: entry.aggregateId,
          commandId: entry.commandId,
          correlationId: entry.correlationId,
          payload: {
            projectId: entry.payload.projectId,
          },
        };
      default:
        return entry;
    }
  });
}

describe("decider deletion flows", () => {
  it("rejects deleting a non-empty project without force", async () => {
    const readModel = await seedReadModel();

    await expect(
      Effect.runPromise(
        decideOrchestrationCommand({
          command: {
            type: "project.delete",
            commandId: asCommandId("cmd-project-delete-no-force"),
            projectId: asProjectId("project-delete"),
          },
          readModel,
        }).pipe(Effect.provide(NodeServices.layer)),
      ),
    ).rejects.toThrow("cannot be deleted without force=true");
  });

  it("reuses session.delete semantics when force-deleting a non-empty project", async () => {
    const readModel = await seedReadModel();
    const projectDeleteCommand: Extract<OrchestrationCommand, { type: "project.delete" }> = {
      type: "project.delete",
      commandId: asCommandId("cmd-project-delete-force"),
      projectId: asProjectId("project-delete"),
      force: true,
    };

    const forcedResult = await Effect.runPromise(
      decideOrchestrationCommand({
        command: projectDeleteCommand,
        readModel,
      }).pipe(Effect.provide(NodeServices.layer)),
    );
    const forcedEvents = Array.isArray(forcedResult) ? forcedResult : [forcedResult];

    expect(forcedEvents.map((event) => event.type)).toEqual([
      "session.deleted",
      "session.deleted",
      "project.deleted",
    ]);

    let sequentialReadModel = readModel;
    let nextSequence = readModel.snapshotSequence;
    const sequentialEvents: PlannedEvent[] = [];
    for (const nextCommand of [
      {
        type: "session.delete",
        commandId: projectDeleteCommand.commandId,
        sessionId: asSessionId("session-delete-1"),
      },
      {
        type: "session.delete",
        commandId: projectDeleteCommand.commandId,
        sessionId: asSessionId("session-delete-2"),
      },
      {
        type: "project.delete",
        commandId: projectDeleteCommand.commandId,
        projectId: asProjectId("project-delete"),
      },
    ] satisfies ReadonlyArray<OrchestrationCommand>) {
      const decided = await Effect.runPromise(
        decideOrchestrationCommand({
          command: nextCommand,
          readModel: sequentialReadModel,
        }).pipe(Effect.provide(NodeServices.layer)),
      );
      const nextEvents = Array.isArray(decided) ? decided : [decided];
      sequentialEvents.push(...nextEvents);
      for (const nextEvent of nextEvents) {
        nextSequence += 1;
        sequentialReadModel = await Effect.runPromise(
          projectEvent(sequentialReadModel, {
            ...nextEvent,
            sequence: nextSequence,
          }),
        );
      }
    }

    expect(normalizeDeleteEvent(forcedResult)).toEqual(normalizeDeleteEvent(sequentialEvents));
  });
});
