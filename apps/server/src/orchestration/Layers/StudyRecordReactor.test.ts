// @effect-diagnostics nodeBuiltinImport:off
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  EventId,
  ProjectId,
  ResearchCardId,
  SessionId,
  type OrchestrationEvent,
  type OrchestrationProjectShell,
  type OrchestrationResearchCard,
  type OrchestrationSession,
} from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Option from "effect/Option";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { afterEach, describe, expect, it } from "vitest";

import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import { StudyRecordReactor } from "../Services/StudyRecordReactor.ts";
import { StudyRecordReactorLive } from "./StudyRecordReactor.ts";

const projectId = ProjectId.make("project-study-record-reactor");
const sessionId = SessionId.make("session-study-record-reactor");
const cardId = ResearchCardId.make("card-study-record-reactor");

const card: OrchestrationResearchCard = {
  id: cardId,
  type: "markdown",
  status: "proposed",
  title: "Endpoint definition",
  preview: { markdown: "Primary endpoint." },
  artifacts: [],
  provenance: [],
  turnId: null,
  createdAt: "2026-03-01T00:00:00.000Z",
  updatedAt: "2026-03-01T00:00:00.000Z",
};

type ResearchCardProposedEvent = Extract<
  OrchestrationEvent,
  { type: "session.research-card-proposed" }
>;

function makeEvent(payload: ResearchCardProposedEvent["payload"]): ResearchCardProposedEvent {
  return {
    sequence: 1,
    eventId: EventId.make("event-study-record-reactor"),
    aggregateKind: "session",
    aggregateId: sessionId,
    occurredAt: "2026-03-01T00:00:00.000Z",
    commandId: null,
    causationEventId: null,
    correlationId: null,
    metadata: {},
    type: "session.research-card-proposed",
    payload,
  };
}

describe("StudyRecordReactor", () => {
  let runtime: ManagedRuntime.ManagedRuntime<StudyRecordReactor, never> | null = null;
  let tempDir: string | null = null;

  afterEach(async () => {
    if (runtime) {
      await runtime.dispose();
    }
    runtime = null;
    if (tempDir) {
      await rm(tempDir, { force: true, recursive: true });
    }
    tempDir = null;
  });

  it("persists study-local card manifests after accepted card events", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "lincei-study-record-reactor-"));
    const studyRoot = tempDir;
    const eventProcessingStarted = await Effect.runPromise(Deferred.make<void>());

    const project: OrchestrationProjectShell = {
      id: projectId,
      title: "Study",
      workspaceRoot: studyRoot,
      repositoryIdentity: null,
      defaultModelSelection: null,
      scripts: [],
      createdAt: "2026-03-01T00:00:00.000Z",
      updatedAt: "2026-03-01T00:00:00.000Z",
    };
    const session = {
      id: sessionId,
      projectId,
    } as OrchestrationSession;

    runtime = ManagedRuntime.make(
      StudyRecordReactorLive.pipe(
        Layer.provide(
          Layer.succeed(OrchestrationEngineService, {
            readEvents: () => Stream.empty,
            dispatch: () => Effect.die("unused"),
            get streamDomainEvents() {
              return Stream.make(
                makeEvent({
                  sessionId,
                  researchCard: card,
                  studyRecord: {
                    deps: [],
                    artifactIds: [],
                    artifacts: [],
                  },
                }),
              );
            },
          }),
        ),
        Layer.provide(
          Layer.succeed(ProjectionSnapshotQuery, {
            getCommandReadModel: () => Effect.die("unused"),
            getSnapshot: () => Effect.die("unused"),
            getShellSnapshot: () => Effect.die("unused"),
            getArchivedShellSnapshot: () => Effect.die("unused"),
            getSnapshotSequence: () => Effect.die("unused"),
            getCounts: () => Effect.die("unused"),
            getActiveProjectByWorkspaceRoot: () => Effect.die("unused"),
            getProjectShellById: () => Effect.succeed(Option.some(project)),
            getFirstActiveSessionIdByProjectId: () => Effect.die("unused"),
            getSessionCheckpointContext: () => Effect.die("unused"),
            getFullSessionDiffContext: () => Effect.die("unused"),
            getSessionShellById: () => Effect.die("unused"),
            getSessionDetailById: () =>
              Deferred.succeed(eventProcessingStarted, undefined).pipe(
                Effect.as(Option.some(session)),
              ),
            getResearchCardDetail: () => Effect.succeed(Option.some(card)),
          }),
        ),
      ),
    );

    const reactor = await runtime.runPromise(Effect.service(StudyRecordReactor));
    const scope = await Effect.runPromise(Scope.make("sequential"));
    await Effect.runPromise(reactor.start().pipe(Scope.provide(scope)));
    await runtime.runPromise(Deferred.await(eventProcessingStarted));
    await runtime.runPromise(reactor.drain);
    await Effect.runPromise(Scope.close(scope, Exit.void));

    const raw = await readFile(path.join(studyRoot, ".lincei", "cards", `${cardId}.json`), "utf8");
    expect(JSON.parse(raw)).toMatchObject({
      id: cardId,
      card: {
        id: cardId,
        title: "Endpoint definition",
      },
    });
  });
});
