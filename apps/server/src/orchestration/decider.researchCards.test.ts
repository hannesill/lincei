import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  EventId,
  ProjectId,
  ProviderInstanceId,
  ResearchCardId,
  SessionId,
  type OrchestrationCommand,
  type OrchestrationReadModel,
  type OrchestrationResearchCard,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { describe, expect, it } from "vitest";

import { decideOrchestrationCommand } from "./decider.ts";
import { createEmptyReadModel, projectEvent } from "./projector.ts";

const now = "2026-01-01T00:00:00.000Z";
const projectId = ProjectId.make("project-research-card-decider");
const sessionId = SessionId.make("session-research-card-decider");
const cardId = ResearchCardId.make("card-existing");

const baseCard = {
  id: cardId,
  type: "markdown",
  status: "proposed",
  title: "Existing card",
  artifacts: [],
  provenance: [],
  turnId: null,
  createdAt: now,
  updatedAt: now,
} satisfies OrchestrationResearchCard;

async function makeReadModel(): Promise<OrchestrationReadModel> {
  const withProject = await Effect.runPromise(
    projectEvent(createEmptyReadModel(now), {
      sequence: 1,
      eventId: EventId.make("evt-project"),
      aggregateKind: "project",
      aggregateId: projectId,
      type: "project.created",
      occurredAt: now,
      commandId: CommandId.make("cmd-project"),
      causationEventId: null,
      correlationId: CommandId.make("cmd-project"),
      metadata: {},
      payload: {
        projectId,
        title: "Project",
        workspaceRoot: "/tmp/project",
        defaultModelSelection: null,
        scripts: [],
        createdAt: now,
        updatedAt: now,
      },
    }),
  );

  const withSession = await Effect.runPromise(
    projectEvent(withProject, {
      sequence: 2,
      eventId: EventId.make("evt-session"),
      aggregateKind: "session",
      aggregateId: sessionId,
      type: "session.created",
      occurredAt: now,
      commandId: CommandId.make("cmd-session"),
      causationEventId: null,
      correlationId: CommandId.make("cmd-session"),
      metadata: {},
      payload: {
        sessionId,
        projectId,
        title: "Session",
        modelSelection: {
          instanceId: ProviderInstanceId.make("codex"),
          model: "gpt-5-codex",
          options: [],
        },
        runtimeMode: "full-access",
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        branch: null,
        worktreePath: null,
        createdAt: now,
        updatedAt: now,
      },
    }),
  );

  return Effect.runPromise(
    projectEvent(withSession, {
      sequence: 3,
      eventId: EventId.make("evt-card"),
      aggregateKind: "session",
      aggregateId: sessionId,
      type: "session.research-card-proposed",
      occurredAt: now,
      commandId: CommandId.make("cmd-card"),
      causationEventId: null,
      correlationId: CommandId.make("cmd-card"),
      metadata: {},
      payload: {
        sessionId,
        researchCard: baseCard,
      },
    }),
  );
}

function decide(command: OrchestrationCommand, readModel: OrchestrationReadModel) {
  return decideOrchestrationCommand({ command, readModel }).pipe(
    Effect.provide(NodeServices.layer),
  );
}

async function expectInvariantFailure(
  command: OrchestrationCommand,
  readModel: OrchestrationReadModel,
) {
  const exit = await Effect.runPromiseExit(decide(command, readModel));
  expect(exit._tag).toBe("Failure");
}

describe("decider research card invariants", () => {
  it("rejects duplicate proposed research cards", async () => {
    const readModel = await makeReadModel();

    await expectInvariantFailure(
      {
        type: "session.research-card.propose",
        commandId: CommandId.make("cmd-duplicate"),
        sessionId,
        researchCard: baseCard,
        createdAt: now,
      },
      readModel,
    );
  });

  it("rejects commands targeting missing research cards", async () => {
    const readModel = await makeReadModel();
    const missingCardId = ResearchCardId.make("card-missing");

    await expectInvariantFailure(
      {
        type: "session.research-card.update",
        commandId: CommandId.make("cmd-update-missing"),
        sessionId,
        cardId: missingCardId,
        researchCard: { ...baseCard, id: missingCardId },
        createdAt: now,
      },
      readModel,
    );
    await expectInvariantFailure(
      {
        type: "session.research-card.review",
        commandId: CommandId.make("cmd-review-missing"),
        sessionId,
        cardId: missingCardId,
        response: { action: "accept", timestamp: now },
        createdAt: now,
      },
      readModel,
    );
    await expectInvariantFailure(
      {
        type: "session.research-card.lifecycle",
        commandId: CommandId.make("cmd-lifecycle-missing"),
        sessionId,
        cardId: missingCardId,
        action: "withdraw",
        createdAt: now,
      },
      readModel,
    );
    await expectInvariantFailure(
      {
        type: "session.research-card.supersede",
        commandId: CommandId.make("cmd-supersede-missing"),
        sessionId,
        cardId: missingCardId,
        replacementCard: { ...baseCard, id: ResearchCardId.make("card-replacement") },
        createdAt: now,
      },
      readModel,
    );
  });

  it("rejects mismatched update and invalid supersede replacement ids", async () => {
    const readModel = await makeReadModel();

    await expectInvariantFailure(
      {
        type: "session.research-card.update",
        commandId: CommandId.make("cmd-update-mismatch"),
        sessionId,
        cardId,
        researchCard: { ...baseCard, id: ResearchCardId.make("card-other") },
        createdAt: now,
      },
      readModel,
    );
    await expectInvariantFailure(
      {
        type: "session.research-card.supersede",
        commandId: CommandId.make("cmd-supersede-same"),
        sessionId,
        cardId,
        replacementCard: baseCard,
        createdAt: now,
      },
      readModel,
    );

    const secondCard = {
      ...baseCard,
      id: ResearchCardId.make("card-existing-2"),
      title: "Existing replacement id",
    } satisfies OrchestrationResearchCard;
    const readModelWithSecondCard = await Effect.runPromise(
      projectEvent(readModel, {
        sequence: 4,
        eventId: EventId.make("evt-card-2"),
        aggregateKind: "session",
        aggregateId: sessionId,
        type: "session.research-card-proposed",
        occurredAt: now,
        commandId: CommandId.make("cmd-card-2"),
        causationEventId: null,
        correlationId: CommandId.make("cmd-card-2"),
        metadata: {},
        payload: {
          sessionId,
          researchCard: secondCard,
        },
      }),
    );
    await expectInvariantFailure(
      {
        type: "session.research-card.supersede",
        commandId: CommandId.make("cmd-supersede-existing-replacement"),
        sessionId,
        cardId,
        replacementCard: secondCard,
        createdAt: now,
      },
      readModelWithSecondCard,
    );
  });
});
