import {
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  EventId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  SessionId,
  type OrchestrationCommand,
  type OrchestrationEvent,
  type OrchestrationReadModel,
  type OrchestrationSession,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import { describe, expect, it } from "vitest";

import { decideOrchestrationCommand } from "./decider.ts";
import { projectEvent } from "./projector.ts";
import { derivePendingRequestCounts } from "./sessionLifecycle.ts";

const SESSION_ID = SessionId.make("session-settled");
const PROJECT_ID = ProjectId.make("project-settled");
const OLD = "2026-07-20T10:00:00.000Z";

function makeSession(overrides: Partial<OrchestrationSession> = {}): OrchestrationSession {
  const messages = overrides.messages ?? [];
  const activities = overrides.activities ?? [];
  return {
    id: SESSION_ID,
    projectId: PROJECT_ID,
    title: "Lifecycle session",
    modelSelection: {
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-5.4",
    },
    runtimeMode: "full-access",
    interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
    workflowId: null,
    workflowVersion: null,
    branch: "feature/lifecycle",
    worktreePath: "/tmp/lifecycle",
    latestTurn: null,
    createdAt: OLD,
    updatedAt: OLD,
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    snoozedUntil: null,
    snoozedAt: null,
    latestUserMessageAt:
      messages
        .filter((message) => message.role === "user")
        .toSorted((left, right) => left.createdAt.localeCompare(right.createdAt))
        .at(-1)?.createdAt ?? null,
    ...derivePendingRequestCounts(activities),
    deletedAt: null,
    messages,
    proposedPlans: [],
    activities,
    checkpoints: [],
    session: null,
    ...overrides,
  };
}

function makeReadModel(overrides: Partial<OrchestrationSession> = {}): OrchestrationReadModel {
  return {
    snapshotSequence: 0,
    projects: [],
    sessions: [makeSession(overrides)],
    updatedAt: OLD,
  };
}

type WithoutSequence<Event> = Event extends unknown ? Omit<Event, "sequence"> : never;
type PlannedEvent = WithoutSequence<OrchestrationEvent>;

function asEvents(
  result:
    | Omit<OrchestrationEvent, "sequence">
    | ReadonlyArray<Omit<OrchestrationEvent, "sequence">>,
): ReadonlyArray<PlannedEvent> {
  const events = Array.isArray(result) ? result : [result];
  return events as ReadonlyArray<PlannedEvent>;
}

function withSequence(event: PlannedEvent, sequence: number): OrchestrationEvent {
  return { ...event, sequence } as OrchestrationEvent;
}

function decide(command: OrchestrationCommand, readModel: OrchestrationReadModel) {
  return Effect.runPromise(
    decideOrchestrationCommand({ command, readModel }).pipe(Effect.provide(NodeServices.layer)),
  );
}

describe("settled session decider", () => {
  it("settles and explicitly unsettles without changing archive state", async () => {
    const readModel = makeReadModel();
    const settledResult = await decide(
      {
        type: "session.settle",
        commandId: CommandId.make("cmd-settle"),
        sessionId: SESSION_ID,
      },
      readModel,
    );
    const settledEvent = asEvents(settledResult)[0]!;
    expect(settledEvent.type).toBe("session.settled");

    const settledModel = await Effect.runPromise(
      projectEvent(readModel, withSequence(settledEvent, 1)),
    );
    expect(settledModel.sessions[0]).toMatchObject({
      archivedAt: null,
      settledOverride: "settled",
      settledAt: settledEvent.type === "session.settled" ? settledEvent.payload.settledAt : null,
    });

    const repeatedResult = await decide(
      {
        type: "session.settle",
        commandId: CommandId.make("cmd-settle-repeat"),
        sessionId: SESSION_ID,
      },
      settledModel,
    );
    const repeatedEvent = asEvents(repeatedResult)[0]!;
    expect(repeatedEvent.type).toBe("session.settled");
    if (settledEvent.type === "session.settled" && repeatedEvent.type === "session.settled") {
      expect(repeatedEvent.payload.settledAt).toBe(settledEvent.payload.settledAt);
      expect(repeatedEvent.payload.updatedAt).toBe(settledEvent.payload.updatedAt);
    }

    const unsettledResult = await decide(
      {
        type: "session.unsettle",
        commandId: CommandId.make("cmd-unsettle"),
        sessionId: SESSION_ID,
        reason: "user",
      },
      settledModel,
    );
    const unsettledEvent = asEvents(unsettledResult)[0]!;
    const activeModel = await Effect.runPromise(
      projectEvent(settledModel, withSequence(unsettledEvent, 2)),
    );
    expect(activeModel.sessions[0]).toMatchObject({
      archivedAt: null,
      settledOverride: "active",
      settledAt: null,
    });
  });

  it("rejects settled transitions while active work is visible", async () => {
    const now = await Effect.runPromise(Effect.map(DateTime.now, DateTime.formatIso));
    const cases = [
      {
        name: "starting provider",
        readModel: makeReadModel({
          session: {
            sessionId: SESSION_ID,
            status: "starting",
            providerName: "codex",
            runtimeMode: "full-access",
            activeTurnId: null,
            lastError: null,
            updatedAt: now,
          },
        }),
        message: "active provider work",
      },
      {
        name: "running provider",
        readModel: makeReadModel({
          session: {
            sessionId: SESSION_ID,
            status: "running",
            providerName: "codex",
            runtimeMode: "full-access",
            activeTurnId: null,
            lastError: null,
            updatedAt: now,
          },
        }),
        message: "active provider work",
      },
      {
        name: "pending approval",
        readModel: makeReadModel({
          activities: [
            {
              id: EventId.make("activity-approval"),
              tone: "approval",
              kind: "approval.requested",
              summary: "Approval needed",
              payload: { requestId: "approval-1" },
              turnId: null,
              createdAt: now,
            },
          ],
        }),
        message: "pending approval or user-input request",
      },
      {
        name: "pending user input",
        readModel: makeReadModel({
          activities: [
            {
              id: EventId.make("activity-user-input"),
              tone: "approval",
              kind: "user-input.requested",
              summary: "Answer needed",
              payload: { requestId: "input-1" },
              turnId: null,
              createdAt: now,
            },
          ],
        }),
        message: "pending approval or user-input request",
      },
      {
        name: "queued turn start",
        readModel: makeReadModel({
          messages: [
            {
              id: MessageId.make("message-queued"),
              role: "user",
              text: "Start work",
              turnId: null,
              streaming: false,
              createdAt: now,
              updatedAt: now,
            },
          ],
        }),
        message: "queued turn start",
      },
      {
        name: "archived session",
        readModel: makeReadModel({
          archivedAt: "2026-07-27T00:00:00.000Z",
        }),
        message: "already archived",
      },
    ] as const;

    for (const testCase of cases) {
      await expect(
        decide(
          {
            type: "session.settle",
            commandId: CommandId.make(`cmd-${testCase.name.replaceAll(" ", "-")}`),
            sessionId: SESSION_ID,
          },
          testCase.readModel,
        ),
        testCase.name,
      ).rejects.toThrow(testCase.message);
    }
  });

  it("uses hydrated lifecycle summaries when command timelines are empty after restart", async () => {
    const now = await Effect.runPromise(Effect.map(DateTime.now, DateTime.formatIso));

    await expect(
      decide(
        {
          type: "session.settle",
          commandId: CommandId.make("cmd-restart-pending"),
          sessionId: SESSION_ID,
        },
        makeReadModel({
          activities: [],
          pendingApprovalCount: 1,
        }),
      ),
    ).rejects.toThrow("pending approval or user-input request");

    await expect(
      decide(
        {
          type: "session.settle",
          commandId: CommandId.make("cmd-restart-queued"),
          sessionId: SESSION_ID,
        },
        makeReadModel({
          messages: [],
          latestUserMessageAt: now,
        }),
      ),
    ).rejects.toThrow("queued turn start");
  });

  it("auto-unsettles manual overrides when provider or user activity begins", async () => {
    const now = await Effect.runPromise(Effect.map(DateTime.now, DateTime.formatIso));
    const settledReadModel = makeReadModel({
      settledOverride: "settled",
      settledAt: OLD,
    });

    const turnEvents = asEvents(
      await decide(
        {
          type: "session.turn.start",
          commandId: CommandId.make("cmd-turn-start"),
          sessionId: SESSION_ID,
          message: {
            messageId: MessageId.make("message-turn-start"),
            role: "user",
            text: "Continue",
            attachments: [],
          },
          runtimeMode: "full-access",
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          createdAt: now,
        },
        settledReadModel,
      ),
    );
    expect(turnEvents.map((event) => event.type)).toEqual([
      "session.unsettled",
      "session.message-sent",
      "session.turn-start-requested",
    ]);
    expect(turnEvents[0]?.type === "session.unsettled" ? turnEvents[0].payload.reason : null).toBe(
      "activity",
    );

    const providerEvents = asEvents(
      await decide(
        {
          type: "session.session.set",
          commandId: CommandId.make("cmd-provider-starting"),
          sessionId: SESSION_ID,
          session: {
            sessionId: SESSION_ID,
            status: "starting",
            providerName: "codex",
            runtimeMode: "full-access",
            activeTurnId: null,
            lastError: null,
            updatedAt: now,
          },
          createdAt: now,
        },
        settledReadModel,
      ),
    );
    expect(providerEvents.map((event) => event.type)).toEqual([
      "session.unsettled",
      "session.session-set",
    ]);

    const approvalEvents = asEvents(
      await decide(
        {
          type: "session.activity.append",
          commandId: CommandId.make("cmd-approval-request"),
          sessionId: SESSION_ID,
          activity: {
            id: EventId.make("activity-approval-request"),
            tone: "approval",
            kind: "approval.requested",
            summary: "Approval needed",
            payload: { requestId: "approval-1" },
            turnId: null,
            createdAt: now,
          },
          createdAt: now,
        },
        settledReadModel,
      ),
    );
    expect(approvalEvents.map((event) => event.type)).toEqual([
      "session.unsettled",
      "session.activity-appended",
    ]);

    const projected = await Effect.runPromise(
      projectEvent(settledReadModel, withSequence(providerEvents[0]!, 1)),
    );
    expect(projected.sessions[0]).toMatchObject({
      archivedAt: null,
      settledOverride: null,
      settledAt: null,
    });
  });
});
