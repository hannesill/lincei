import {
  ProviderDriverKind,
  ProviderInstanceId,
  type ProviderRuntimeEvent,
  type ProviderSession,
  SessionId,
  type TurnId,
} from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Stream from "effect/Stream";

import {
  buildDemoHydrationRequests,
  type DemoHydrationRequest,
} from "../../../../demos/providerHydration.ts";
import type { DemoScenario } from "../../../../demos/schema.ts";
import type { ProviderServiceShape } from "../provider/Services/ProviderService.ts";
import type { ProviderSessionDirectoryShape } from "../provider/Services/ProviderSessionDirectory.ts";

export interface DemoHydrationResult {
  readonly sessionId: SessionId;
  readonly providerThreadId: string | null;
  readonly hydrationMode: "summary" | "deep";
  readonly providerTurnCount: number;
}

function isHydrationTurnCompleted(
  event: ProviderRuntimeEvent,
  request: DemoHydrationRequest,
): boolean {
  return event.type === "turn.completed" && event.sessionId === SessionId.make(request.sessionId);
}

function readProviderThreadId(session: ProviderSession): string | null {
  return readProviderThreadIdFromCursor(session.resumeCursor);
}

function readProviderThreadIdFromCursor(cursor: ProviderSession["resumeCursor"]): string | null {
  if (
    typeof cursor === "object" &&
    cursor !== null &&
    "sessionId" in cursor &&
    typeof (cursor as { sessionId?: unknown }).sessionId === "string"
  ) {
    return (cursor as { sessionId: string }).sessionId;
  }
  return null;
}

export function hydrateDemoProviderSessions(input: {
  readonly scenario: DemoScenario;
  readonly providerService: ProviderServiceShape;
  readonly providerSessionDirectory: ProviderSessionDirectoryShape;
}) {
  return Effect.forEach(
    buildDemoHydrationRequests(input.scenario),
    (request) =>
      Effect.gen(function* () {
        const sessionId = SessionId.make(request.sessionId);
        const provider = ProviderDriverKind.make(request.provider);
        const providerInstanceId = ProviderInstanceId.make(request.providerInstanceId);
        const modelSelection = createModelSelection(
          providerInstanceId,
          request.modelSelection.model,
        );

        const session = yield* input.providerService.startSession(sessionId, {
          sessionId,
          provider,
          providerInstanceId,
          cwd: request.cwd,
          workspaceRoot: request.cwd,
          modelSelection,
          runtimeMode: request.runtimeMode,
        });

        const hydrationTurnIds: TurnId[] = [];
        let resumeCursor = session.resumeCursor;
        for (const hydrationTurn of request.turns) {
          const turnCompletedFiber = yield* Stream.filter(
            input.providerService.streamEvents,
            (event) => isHydrationTurnCompleted(event, request),
          ).pipe(Stream.runHead, Effect.timeout("5 minutes"), Effect.forkChild);
          yield* Effect.yieldNow;
          const turn = yield* input.providerService.sendTurn({
            sessionId,
            input: hydrationTurn.prompt,
            attachments: [],
            modelSelection,
            interactionMode: "default",
          });
          yield* Fiber.join(turnCompletedFiber);
          hydrationTurnIds.push(turn.turnId);
          resumeCursor = turn.resumeCursor ?? resumeCursor;
        }
        const hydratedAt = DateTime.formatIso(yield* DateTime.now);

        yield* input.providerSessionDirectory.upsert({
          sessionId,
          provider,
          providerInstanceId,
          runtimeMode: request.runtimeMode,
          status: "stopped",
          ...(resumeCursor !== undefined ? { resumeCursor } : {}),
          runtimePayload: {
            cwd: request.cwd,
            modelSelection,
            demoHydration: {
              ...request.metadata,
              hydratedAt,
              hydrationTurnIds,
            },
          },
        });

        return {
          sessionId,
          providerThreadId:
            readProviderThreadIdFromCursor(resumeCursor) ?? readProviderThreadId(session),
          hydrationMode: request.metadata.hydrationMode,
          providerTurnCount: request.turns.length,
        } satisfies DemoHydrationResult;
      }),
    { concurrency: 1 },
  );
}
