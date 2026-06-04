import {
  EventId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ProviderRuntimeEvent,
  type ProviderSendTurnInput,
  type ProviderSessionStartInput,
  TurnId,
} from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Stream from "effect/Stream";

import { buildDemoHydrationRequests } from "../../../../demos/providerHydration.ts";
import { validateDemoScenario, type DemoScenario } from "../../../../demos/schema.ts";
import type { ProviderServiceShape } from "../provider/Services/ProviderService.ts";
import type {
  ProviderRuntimeBinding,
  ProviderSessionDirectoryShape,
} from "../provider/Services/ProviderSessionDirectory.ts";
import { hydrateDemoProviderSessions } from "./providerHydration.ts";

const scenario = validateDemoScenario({
  scenarioId: "demo-test",
  title: "Demo Test",
  baseTimestamp: "2026-05-18T09:00:00.000Z",
  organizationName: "Demo Org",
  therapeuticArea: "critical care",
  studies: [
    {
      id: "demo-study-test",
      title: "Demo Study",
      workspaceRoot: ".demo-home/workspaces/test",
      files: [{ path: "protocol/test.md", content: "# Test" }],
      sessions: [
        {
          id: "demo-session-cardio-protocol",
          title: "Demo Session",
          messages: [
            {
              id: "demo-message-test-user",
              role: "user",
              text: "Summarize protocol state.",
              turnId: "demo-turn-test",
              createdAtOffsetMinutes: 1,
            },
            {
              id: "demo-message-test-assistant",
              role: "assistant",
              text: "Protocol is ready for review.",
              turnId: "demo-turn-test",
              createdAtOffsetMinutes: 2,
            },
            {
              id: "demo-message-test-user-2",
              role: "user",
              text: "Add reviewer checks.",
              turnId: "demo-turn-test-2",
              createdAtOffsetMinutes: 3,
            },
            {
              id: "demo-message-test-assistant-2",
              role: "assistant",
              text: "Reviewer checks are ready.",
              turnId: "demo-turn-test-2",
              createdAtOffsetMinutes: 4,
            },
            {
              id: "demo-message-test-user-3",
              role: "user",
              text: "Stage the resume point.",
              turnId: "demo-turn-test-3",
              createdAtOffsetMinutes: 5,
            },
            {
              id: "demo-message-test-assistant-3",
              role: "assistant",
              text: "Resume point staged.",
              turnId: "demo-turn-test-3",
              createdAtOffsetMinutes: 6,
            },
          ],
          cards: [
            {
              id: "demo-card-test",
              type: "markdown",
              status: "review-requested",
              title: "Protocol",
              artifacts: [
                {
                  id: "demo-artifact-test",
                  kind: "markdown",
                  path: "protocol/test.md",
                  label: "Protocol",
                },
              ],
              turnId: "demo-turn-test",
              createdAtOffsetMinutes: 3,
              reviewPrompt: "Review protocol.",
            },
          ],
          activities: [],
        },
      ],
    },
  ],
} satisfies DemoScenario);

it.effect("hydrates provider-backed demo sessions and persists resumable bindings", () =>
  Effect.gen(function* () {
    const pubSub = yield* PubSub.unbounded<ProviderRuntimeEvent>();
    const starts: ProviderSessionStartInput[] = [];
    const sends: ProviderSendTurnInput[] = [];
    const upserts: ProviderRuntimeBinding[] = [];
    const provider = ProviderDriverKind.make("codex");
    const providerInstanceId = ProviderInstanceId.make("codex");

    const providerService: ProviderServiceShape = {
      startSession: (sessionId, input) =>
        Effect.sync(() => {
          starts.push(input);
          return {
            provider,
            providerInstanceId,
            status: "ready" as const,
            runtimeMode: input.runtimeMode,
            sessionId,
            resumeCursor: { sessionId: `codex-thread-${sessionId}` },
            cwd: input.cwd,
            createdAt: "2026-05-18T09:00:00.000Z",
            updatedAt: "2026-05-18T09:00:00.000Z",
          };
        }),
      sendTurn: (input) =>
        Effect.gen(function* () {
          sends.push(input);
          const turnId = TurnId.make(`turn-${input.sessionId}`);
          yield* PubSub.publish(pubSub, {
            type: "turn.completed",
            eventId: EventId.make(`event-${input.sessionId}`),
            provider,
            providerInstanceId,
            sessionId: input.sessionId,
            turnId,
            createdAt: "2026-05-18T09:00:01.000Z",
            payload: { state: "completed" },
          } as ProviderRuntimeEvent);
          return {
            sessionId: input.sessionId,
            turnId,
            resumeCursor: { sessionId: `codex-thread-${input.sessionId}` },
          };
        }),
      interruptTurn: () => Effect.void,
      respondToRequest: () => Effect.void,
      respondToUserInput: () => Effect.void,
      stopSession: () => Effect.void,
      listSessions: () => Effect.succeed([]),
      getCapabilities: () => Effect.succeed({ sessionModelSwitch: "in-session" as const }),
      getInstanceInfo: (instanceId) =>
        Effect.succeed({
          instanceId,
          driverKind: provider,
          displayName: undefined,
          continuationIdentity: {
            driverKind: provider,
            continuationKey: `${provider}:instance:${instanceId}`,
          },
          enabled: true,
        }),
      rollbackConversation: () => Effect.void,
      streamEvents: Stream.fromPubSub(pubSub),
    };

    const providerSessionDirectory: ProviderSessionDirectoryShape = {
      upsert: (binding) =>
        Effect.sync(() => {
          upserts.push(binding);
        }),
      getProvider: () => Effect.succeed(provider),
      getBinding: () => Effect.succeed(Option.none()),
      listSessionIds: () => Effect.succeed([]),
      listBindings: () => Effect.succeed([]),
    };

    const result = yield* hydrateDemoProviderSessions({
      scenario,
      providerService,
      providerSessionDirectory,
    });
    const request = buildDemoHydrationRequests(scenario)[0];

    assert.equal(result.length, 1);
    assert.equal(result[0]?.providerThreadId, "codex-thread-demo-session-cardio-protocol");
    assert.equal(result[0]?.hydrationMode, "deep");
    assert.equal(result[0]?.providerTurnCount, 3);
    assert.equal(starts.length, 1);
    assert.equal(starts[0]?.cwd, ".demo-home/workspaces/test");
    assert.equal(sends.length, 3);
    assert.deepEqual(
      sends.map((send) => send.input),
      request?.turns.map((turn) => turn.prompt),
    );
    assert.equal(upserts.length, 1);
    assert.equal(upserts[0]?.status, "stopped");
    assert.deepEqual(upserts[0]?.resumeCursor, {
      sessionId: "codex-thread-demo-session-cardio-protocol",
    });
    assert.deepEqual(
      (upserts[0]?.runtimePayload as { cwd?: string } | undefined)?.cwd,
      request?.cwd,
    );
    const demoHydration = (
      upserts[0]?.runtimePayload as
        | { demoHydration?: { hydrationMode?: string; providerTurnCount?: number } }
        | undefined
    )?.demoHydration;
    assert.equal(demoHydration?.hydrationMode, "deep");
    assert.equal(demoHydration?.providerTurnCount, 3);
  }),
);
