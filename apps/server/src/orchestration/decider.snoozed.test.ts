import {
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  EventId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  SessionId,
  type OrchestrationEvent,
  type OrchestrationReadModel,
  type OrchestrationSession,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { decideOrchestrationCommand } from "./decider.ts";
import { derivePendingRequestCounts } from "./sessionLifecycle.ts";

const NOW = "2026-01-01T00:00:00.000Z";
// NodeServices' Effect test clock is pinned to the epoch.
const FUTURE_WAKE = "1970-01-02T09:00:00.000Z";
const EXTENDED_WAKE = "1970-01-03T09:00:00.000Z";
const PAST_WAKE = "1969-12-31T09:00:00.000Z";
const SNOOZED_AT = "1969-12-30T00:00:00.000Z";
const SESSION_ID = SessionId.make("session-snoozed");

function makeReadModel(
  input: {
    readonly snoozedUntil?: string | null;
    readonly snoozedAt?: string | null;
    readonly archivedAt?: string | null;
    readonly settledOverride?: "settled" | "active" | null;
    readonly settledAt?: string | null;
    readonly activities?: OrchestrationSession["activities"];
    readonly messages?: OrchestrationSession["messages"];
    readonly runtimeStatus?: "starting" | "running" | "ready" | "error";
  } = {},
): OrchestrationReadModel {
  const messages = input.messages ?? [];
  const activities = input.activities ?? [];
  const pendingRequestCounts = derivePendingRequestCounts(activities);
  return {
    snapshotSequence: 0,
    projects: [],
    sessions: [
      {
        id: SESSION_ID,
        projectId: ProjectId.make("project-snoozed"),
        title: "Snoozed session",
        modelSelection: {
          instanceId: ProviderInstanceId.make("codex"),
          model: "gpt-5.4",
        },
        runtimeMode: "full-access",
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        workflowId: null,
        workflowVersion: null,
        branch: null,
        worktreePath: null,
        latestTurn: null,
        createdAt: NOW,
        updatedAt: NOW,
        archivedAt: input.archivedAt ?? null,
        settledOverride: input.settledOverride ?? null,
        settledAt: input.settledAt ?? null,
        snoozedUntil: input.snoozedUntil ?? null,
        snoozedAt: input.snoozedAt ?? (input.snoozedUntil !== undefined ? SNOOZED_AT : null),
        latestUserMessageAt:
          messages
            .filter((message) => message.role === "user")
            .toSorted((left, right) => left.createdAt.localeCompare(right.createdAt))
            .at(-1)?.createdAt ?? null,
        ...pendingRequestCounts,
        deletedAt: null,
        messages,
        proposedPlans: [],
        activities,
        checkpoints: [],
        session:
          input.runtimeStatus === undefined
            ? null
            : {
                sessionId: SESSION_ID,
                status: input.runtimeStatus,
                providerName: "codex",
                runtimeMode: "full-access",
                activeTurnId: null,
                lastError: input.runtimeStatus === "error" ? "boom" : null,
                updatedAt: NOW,
              },
      },
    ],
    updatedAt: NOW,
  };
}

type WithoutSequence<Event> = Event extends unknown ? Omit<Event, "sequence"> : never;
type PlannedEvent = WithoutSequence<OrchestrationEvent>;

function eventList(
  result:
    | Omit<OrchestrationEvent, "sequence">
    | ReadonlyArray<Omit<OrchestrationEvent, "sequence">>,
): ReadonlyArray<PlannedEvent> {
  return (Array.isArray(result) ? result : [result]) as ReadonlyArray<PlannedEvent>;
}

it.layer(NodeServices.layer)("snoozed session decider", (it) => {
  it.effect("snoozes quiet and running sessions to a future wake time", () =>
    Effect.gen(function* () {
      for (const readModel of [makeReadModel(), makeReadModel({ runtimeStatus: "running" })]) {
        const result = yield* decideOrchestrationCommand({
          command: {
            type: "session.snooze",
            commandId: CommandId.make("cmd-snooze"),
            sessionId: SESSION_ID,
            snoozedUntil: FUTURE_WAKE,
          },
          readModel,
        });
        const events = eventList(result);
        expect(events).toHaveLength(1);
        expect(events[0]?.type).toBe("session.snoozed");
        if (events[0]?.type === "session.snoozed") {
          expect(events[0].payload.snoozedUntil).toBe(FUTURE_WAKE);
          expect(events[0].payload.snoozedAt).toBe(events[0].payload.updatedAt);
        }
      }
    }),
  );

  it.effect("rejects malformed, past, and excessive wake times without reflecting input", () =>
    Effect.gen(function* () {
      for (const [label, snoozedUntil] of [
        ["past", PAST_WAKE],
        ["unparseable", "not-a-date"],
        ["noncanonical", "1970-01-02T09:00:00Z"],
        ["oversized", "9".repeat(10_000)],
        ["excessive-horizon", "1971-01-02T09:00:00.000Z"],
      ] as const) {
        const error = yield* decideOrchestrationCommand({
          command: {
            type: "session.snooze",
            commandId: CommandId.make(`cmd-invalid-${label}`),
            sessionId: SESSION_ID,
            snoozedUntil,
          },
          readModel: makeReadModel(),
        }).pipe(Effect.flip);
        expect(error._tag).toBe("OrchestrationCommandInvariantError");
        expect(error.message).not.toContain(snoozedUntil);
      }
    }),
  );

  it.effect("rejects pending approval and user-input requests", () =>
    Effect.gen(function* () {
      for (const kind of ["approval.requested", "user-input.requested"] as const) {
        const requestActivity = {
          id: EventId.make(`activity-${kind}`),
          tone: "approval" as const,
          kind,
          summary: kind,
          payload: { requestId: `request-${kind}` },
          turnId: null,
          createdAt: NOW,
        } as OrchestrationSession["activities"][number];
        const error = yield* decideOrchestrationCommand({
          command: {
            type: "session.snooze",
            commandId: CommandId.make(`cmd-blocked-${kind}`),
            sessionId: SESSION_ID,
            snoozedUntil: FUTURE_WAKE,
          },
          readModel: makeReadModel({ activities: [requestActivity] }),
        }).pipe(Effect.flip);
        expect(error._tag).toBe("OrchestrationCommandInvariantError");
      }
    }),
  );

  it.effect("rejects queued turns and archived sessions", () =>
    Effect.gen(function* () {
      const queuedMessage = {
        id: MessageId.make("message-queued"),
        role: "user" as const,
        text: "Continue",
        turnId: null,
        streaming: false,
        createdAt: "1969-12-31T23:59:30.000Z",
        updatedAt: "1969-12-31T23:59:30.000Z",
      } as OrchestrationSession["messages"][number];
      const blockedModels = [
        makeReadModel({ messages: [queuedMessage] }),
        makeReadModel({ archivedAt: NOW }),
      ];
      for (const [index, readModel] of blockedModels.entries()) {
        const error = yield* decideOrchestrationCommand({
          command: {
            type: "session.snooze",
            commandId: CommandId.make(`cmd-blocked-${index}`),
            sessionId: SESSION_ID,
            snoozedUntil: FUTURE_WAKE,
          },
          readModel,
        }).pipe(Effect.flip);
        expect(error._tag).toBe("OrchestrationCommandInvariantError");
      }
    }),
  );

  it.effect("preserves timestamps for a duplicate same-wake snooze", () =>
    Effect.gen(function* () {
      const result = yield* decideOrchestrationCommand({
        command: {
          type: "session.snooze",
          commandId: CommandId.make("cmd-snooze-duplicate"),
          sessionId: SESSION_ID,
          snoozedUntil: FUTURE_WAKE,
        },
        readModel: makeReadModel({ snoozedUntil: FUTURE_WAKE }),
      });
      const event = eventList(result)[0];
      expect(event?.type).toBe("session.snoozed");
      if (event?.type === "session.snoozed") {
        expect(event.payload.snoozedAt).toBe(SNOOZED_AT);
        expect(event.payload.updatedAt).toBe(NOW);
      }
    }),
  );

  it.effect("stamps a different wake time as a fresh snooze", () =>
    Effect.gen(function* () {
      const result = yield* decideOrchestrationCommand({
        command: {
          type: "session.snooze",
          commandId: CommandId.make("cmd-snooze-extend"),
          sessionId: SESSION_ID,
          snoozedUntil: EXTENDED_WAKE,
        },
        readModel: makeReadModel({ snoozedUntil: FUTURE_WAKE }),
      });
      const event = eventList(result)[0];
      expect(event?.type).toBe("session.snoozed");
      if (event?.type === "session.snoozed") {
        expect(event.payload.snoozedUntil).toBe(EXTENDED_WAKE);
        expect(event.payload.snoozedAt).not.toBe(SNOOZED_AT);
        expect(event.payload.updatedAt).not.toBe(NOW);
      }
    }),
  );

  it.effect("unsnoozes explicitly and re-emits awake state idempotently", () =>
    Effect.gen(function* () {
      const wake = yield* decideOrchestrationCommand({
        command: {
          type: "session.unsnooze",
          commandId: CommandId.make("cmd-unsnooze"),
          sessionId: SESSION_ID,
          reason: "user",
        },
        readModel: makeReadModel({ snoozedUntil: FUTURE_WAKE }),
      });
      const wakeEvent = eventList(wake)[0];
      expect(wakeEvent?.type).toBe("session.unsnoozed");
      if (wakeEvent?.type === "session.unsnoozed") {
        expect(wakeEvent.payload.reason).toBe("user");
        expect(wakeEvent.payload.updatedAt).not.toBe(NOW);
      }

      const duplicate = yield* decideOrchestrationCommand({
        command: {
          type: "session.unsnooze",
          commandId: CommandId.make("cmd-unsnooze-awake"),
          sessionId: SESSION_ID,
          reason: "user",
        },
        readModel: makeReadModel(),
      });
      const duplicateEvent = eventList(duplicate)[0];
      expect(duplicateEvent?.type).toBe("session.unsnoozed");
      if (duplicateEvent?.type === "session.unsnoozed") {
        expect(duplicateEvent.payload.updatedAt).toBe(NOW);
      }
    }),
  );

  it.effect("spends snooze and either settled override on a user turn", () =>
    Effect.gen(function* () {
      for (const settledOverride of ["settled", "active"] as const) {
        const result = yield* decideOrchestrationCommand({
          command: {
            type: "session.turn.start",
            commandId: CommandId.make(`cmd-turn-start-${settledOverride}`),
            sessionId: SESSION_ID,
            message: {
              messageId: MessageId.make(`message-turn-start-${settledOverride}`),
              role: "user",
              text: "Continue",
              attachments: [],
            },
            runtimeMode: "full-access",
            interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
            createdAt: NOW,
          },
          readModel: makeReadModel({
            settledOverride,
            settledAt: settledOverride === "settled" ? SNOOZED_AT : null,
            snoozedUntil: FUTURE_WAKE,
          }),
        });
        const events = eventList(result);
        expect(events.map((event) => event.type)).toEqual([
          "session.unsettled",
          "session.unsnoozed",
          "session.message-sent",
          "session.turn-start-requested",
        ]);
        const unsettled = events[0];
        const unsnoozed = events[1];
        if (unsettled?.type === "session.unsettled") {
          expect(unsettled.payload.reason).toBe("activity");
        }
        if (unsnoozed?.type === "session.unsnoozed") {
          expect(unsnoozed.payload.reason).toBe("activity");
        }
      }
    }),
  );

  it.effect("keeps snooze persistence while provider activity raises a client-side hand", () =>
    Effect.gen(function* () {
      const result = yield* decideOrchestrationCommand({
        command: {
          type: "session.session.set",
          commandId: CommandId.make("cmd-provider-running"),
          sessionId: SESSION_ID,
          session: {
            sessionId: SESSION_ID,
            status: "running",
            providerName: "codex",
            runtimeMode: "full-access",
            activeTurnId: null,
            lastError: null,
            updatedAt: NOW,
          },
          createdAt: NOW,
        },
        readModel: makeReadModel({
          settledOverride: "settled",
          settledAt: SNOOZED_AT,
          snoozedUntil: FUTURE_WAKE,
        }),
      });
      expect(eventList(result).map((event) => event.type)).toEqual([
        "session.unsettled",
        "session.session-set",
      ]);
    }),
  );
});
