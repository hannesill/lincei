import type { OrchestrationEvent } from "@t3tools/contracts";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import { ProviderService } from "../../provider/Services/ProviderService.ts";
import { TerminalManager } from "../../terminal/Services/Manager.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import {
  SessionDeletionReactor,
  type SessionDeletionReactorShape,
} from "../Services/SessionDeletionReactor.ts";

type SessionDeletedEvent = Extract<OrchestrationEvent, { type: "session.deleted" }>;

export const logCleanupCauseUnlessInterrupted = <R, E>({
  effect,
  message,
  sessionId,
}: {
  readonly effect: Effect.Effect<void, E, R>;
  readonly message: string;
  readonly sessionId: SessionDeletedEvent["payload"]["sessionId"];
}): Effect.Effect<void, E, R> =>
  effect.pipe(
    Effect.catchCause((cause) => {
      if (Cause.hasInterruptsOnly(cause)) {
        return Effect.failCause(cause);
      }
      return Effect.logDebug(message, {
        sessionId,
        cause: Cause.pretty(cause),
      });
    }),
  );

const make = Effect.gen(function* () {
  const orchestrationEngine = yield* OrchestrationEngineService;
  const providerService = yield* ProviderService;
  const terminalManager = yield* TerminalManager;

  const stopProviderSession = (sessionId: SessionDeletedEvent["payload"]["sessionId"]) =>
    logCleanupCauseUnlessInterrupted({
      effect: providerService.stopSession({ sessionId }),
      message: "session deletion cleanup skipped provider session stop",
      sessionId,
    });

  const closeSessionTerminals = (sessionId: SessionDeletedEvent["payload"]["sessionId"]) =>
    logCleanupCauseUnlessInterrupted({
      effect: terminalManager.close({ sessionId, deleteHistory: true }),
      message: "session deletion cleanup skipped terminal close",
      sessionId,
    });

  const processSessionDeleted = Effect.fn("processSessionDeleted")(function* (
    event: SessionDeletedEvent,
  ) {
    const { sessionId } = event.payload;
    yield* stopProviderSession(sessionId);
    yield* closeSessionTerminals(sessionId);
  });

  const processSessionDeletedSafely = (event: SessionDeletedEvent) =>
    processSessionDeleted(event).pipe(
      Effect.catchCause((cause) => {
        if (Cause.hasInterruptsOnly(cause)) {
          return Effect.failCause(cause);
        }
        return Effect.logWarning("session deletion reactor failed to process event", {
          eventType: event.type,
          sessionId: event.payload.sessionId,
          cause: Cause.pretty(cause),
        });
      }),
    );

  const worker = yield* makeDrainableWorker(processSessionDeletedSafely);

  const start: SessionDeletionReactorShape["start"] = Effect.fn("start")(function* () {
    yield* Effect.forkScoped(
      Stream.runForEach(orchestrationEngine.streamDomainEvents, (event) => {
        if (event.type !== "session.deleted") {
          return Effect.void;
        }
        return worker.enqueue(event);
      }),
    );
  });

  return {
    start,
    drain: worker.drain,
  } satisfies SessionDeletionReactorShape;
});

export const SessionDeletionReactorLive = Layer.effect(SessionDeletionReactor, make);
