import type {
  OrchestrationEvent,
  OrchestrationResearchCard,
  ResearchCardStudyRecordMetadata,
  SessionId,
} from "@t3tools/contracts";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import * as Cause from "effect/Cause";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import { upsertCardManifest } from "../../study/StudyRecordService.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import {
  StudyRecordReactor,
  type StudyRecordReactorShape,
} from "../Services/StudyRecordReactor.ts";

class StudyRecordReactorPersistError extends Data.TaggedError("StudyRecordReactorPersistError")<{
  readonly cause: unknown;
}> {}

type ResearchCardStudyRecordEvent = Extract<
  OrchestrationEvent,
  {
    type:
      | "session.research-card-proposed"
      | "session.research-card-updated"
      | "session.research-card-reviewed"
      | "session.research-card-lifecycle-updated"
      | "session.research-card-superseded";
  }
>;

function getStudyRecordMetadata(
  event: ResearchCardStudyRecordEvent,
): ResearchCardStudyRecordMetadata | undefined {
  return event.payload.studyRecord;
}

function getInlineResearchCard(
  event: ResearchCardStudyRecordEvent,
): OrchestrationResearchCard | undefined {
  switch (event.type) {
    case "session.research-card-proposed":
    case "session.research-card-updated":
      return event.payload.researchCard;
    case "session.research-card-superseded":
      return event.payload.replacementCard;
    case "session.research-card-reviewed":
    case "session.research-card-lifecycle-updated":
      return undefined;
  }
}

function getTargetCardId(event: ResearchCardStudyRecordEvent) {
  switch (event.type) {
    case "session.research-card-proposed":
      return event.payload.researchCard.id;
    case "session.research-card-updated":
    case "session.research-card-reviewed":
    case "session.research-card-lifecycle-updated":
    case "session.research-card-superseded":
      return event.payload.cardId;
  }
}

const make = Effect.gen(function* () {
  const orchestrationEngine = yield* OrchestrationEngineService;
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;

  const resolveStudyRoot = Effect.fn("StudyRecordReactor.resolveStudyRoot")(function* (
    sessionId: SessionId,
  ) {
    const session = yield* projectionSnapshotQuery.getSessionDetailById(sessionId);
    if (Option.isNone(session)) {
      return Option.none<string>();
    }
    const project = yield* projectionSnapshotQuery.getProjectShellById(session.value.projectId);
    return Option.map(project, (value) => value.workspaceRoot);
  });

  const loadProjectedCard = Effect.fn("StudyRecordReactor.loadProjectedCard")(function* (
    event: ResearchCardStudyRecordEvent,
  ) {
    const inlineCard = getInlineResearchCard(event);
    if (inlineCard !== undefined) {
      return Option.some(inlineCard);
    }
    return yield* projectionSnapshotQuery.getResearchCardDetail({
      sessionId: event.payload.sessionId,
      cardId: getTargetCardId(event),
    });
  });

  const processEvent = Effect.fn("StudyRecordReactor.processEvent")(function* (
    event: ResearchCardStudyRecordEvent,
  ) {
    const metadata = getStudyRecordMetadata(event);
    if (metadata === undefined) {
      return;
    }

    const [studyRoot, card] = yield* Effect.all([
      resolveStudyRoot(event.payload.sessionId),
      loadProjectedCard(event),
    ]);
    if (Option.isNone(studyRoot) || Option.isNone(card)) {
      yield* Effect.logWarning("study record reactor skipped research card persistence", {
        eventType: event.type,
        sessionId: event.payload.sessionId,
        cardId: getTargetCardId(event),
      });
      return;
    }

    yield* Effect.tryPromise({
      try: () =>
        upsertCardManifest({
          studyRoot: studyRoot.value,
          card: card.value,
          deps: metadata.deps,
          artifactIds: metadata.artifactIds,
          artifacts: metadata.artifacts,
          ...(metadata.runId !== undefined ? { runId: metadata.runId } : {}),
        }),
      catch: (cause) => new StudyRecordReactorPersistError({ cause }),
    }).pipe(
      Effect.catchCause((cause) => {
        if (Cause.hasInterruptsOnly(cause)) {
          return Effect.failCause(cause);
        }
        return Effect.logWarning("study record reactor failed to persist research card", {
          eventType: event.type,
          sessionId: event.payload.sessionId,
          cardId: getTargetCardId(event),
          cause: Cause.pretty(cause),
        });
      }),
    );
  });

  const worker = yield* makeDrainableWorker(processEvent);

  const start: StudyRecordReactorShape["start"] = Effect.fn("start")(function* () {
    yield* Effect.forkScoped(
      Stream.runForEach(orchestrationEngine.streamDomainEvents, (event) => {
        switch (event.type) {
          case "session.research-card-proposed":
          case "session.research-card-updated":
          case "session.research-card-reviewed":
          case "session.research-card-lifecycle-updated":
          case "session.research-card-superseded":
            return worker.enqueue(event);
          default:
            return Effect.void;
        }
      }),
    );
  });

  return {
    start,
    drain: worker.drain,
  } satisfies StudyRecordReactorShape;
});

export const StudyRecordReactorLive = Layer.effect(StudyRecordReactor, make);
