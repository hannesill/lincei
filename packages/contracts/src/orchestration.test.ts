import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  DEFAULT_PROVIDER_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  ModelSelection,
  OrchestrationCommand,
  OrchestrationEvent,
  OrchestrationGetFullSessionDiffInput,
  OrchestrationGetTurnDiffInput,
  OrchestrationLatestTurn,
  ProjectCreatedPayload,
  ProjectMetaUpdatedPayload,
  OrchestrationProposedPlan,
  OrchestrationProviderRuntime,
  OrchestrationResearchCard,
  OrchestrationSession,
  ProjectCreateCommand,
  SessionMetaUpdatedPayload,
  SessionTurnStartCommand,
  SessionCreatedPayload,
  SessionTurnDiff,
  SessionTurnStartRequestedPayload,
} from "./orchestration.ts";
import { ProviderInstanceId } from "./providerInstance.ts";

const decodeTurnDiffInput = Schema.decodeUnknownEffect(OrchestrationGetTurnDiffInput);
const decodeFullSessionDiffInput = Schema.decodeUnknownEffect(OrchestrationGetFullSessionDiffInput);
const decodeSessionTurnDiff = Schema.decodeUnknownEffect(SessionTurnDiff);
const decodeProjectCreateCommand = Schema.decodeUnknownEffect(ProjectCreateCommand);
const decodeProjectCreatedPayload = Schema.decodeUnknownEffect(ProjectCreatedPayload);
const decodeProjectMetaUpdatedPayload = Schema.decodeUnknownEffect(ProjectMetaUpdatedPayload);
const decodeSessionTurnStartCommand = Schema.decodeUnknownEffect(SessionTurnStartCommand);
const decodeSessionTurnStartRequestedPayload = Schema.decodeUnknownEffect(
  SessionTurnStartRequestedPayload,
);
const decodeOrchestrationLatestTurn = Schema.decodeUnknownEffect(OrchestrationLatestTurn);
const decodeOrchestrationProposedPlan = Schema.decodeUnknownEffect(OrchestrationProposedPlan);
const decodeOrchestrationProviderRuntime = Schema.decodeUnknownEffect(OrchestrationProviderRuntime);
const decodeOrchestrationResearchCard = Schema.decodeUnknownEffect(OrchestrationResearchCard);
const decodeOrchestrationSession = Schema.decodeUnknownEffect(OrchestrationSession);
const encodeSessionCreatedPayload = Schema.encodeEffect(SessionCreatedPayload);

function getOptionValue(
  options: ReadonlyArray<{ id: string; value: unknown }> | undefined,
  id: string,
): unknown {
  return options?.find((option) => option.id === id)?.value;
}
const decodeSessionCreatedPayload = Schema.decodeUnknownEffect(SessionCreatedPayload);
const decodeOrchestrationCommand = Schema.decodeUnknownEffect(OrchestrationCommand);
const decodeOrchestrationEvent = Schema.decodeUnknownEffect(OrchestrationEvent);
const decodeSessionMetaUpdatedPayload = Schema.decodeUnknownEffect(SessionMetaUpdatedPayload);

it.effect("parses turn diff input when fromTurnCount <= toTurnCount", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeTurnDiffInput({
      sessionId: "session-1",
      fromTurnCount: 1,
      toTurnCount: 2,
    });
    assert.strictEqual(parsed.fromTurnCount, 1);
    assert.strictEqual(parsed.toTurnCount, 2);
  }),
);

it.effect("parses turn diff input with whitespace ignoring enabled", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeTurnDiffInput({
      sessionId: "session-1",
      fromTurnCount: 1,
      toTurnCount: 2,
      ignoreWhitespace: true,
    });
    assert.strictEqual(parsed.ignoreWhitespace, true);
  }),
);

it.effect("parses full session diff input with whitespace ignoring enabled", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeFullSessionDiffInput({
      sessionId: "session-1",
      toTurnCount: 2,
      ignoreWhitespace: true,
    });
    assert.strictEqual(parsed.ignoreWhitespace, true);
  }),
);

it.effect("rejects turn diff input when fromTurnCount > toTurnCount", () =>
  Effect.gen(function* () {
    const result = yield* Effect.exit(
      decodeTurnDiffInput({
        sessionId: "session-1",
        fromTurnCount: 3,
        toTurnCount: 2,
      }),
    );
    assert.strictEqual(result._tag, "Failure");
  }),
);

it.effect("rejects session turn diff when fromTurnCount > toTurnCount", () =>
  Effect.gen(function* () {
    const result = yield* Effect.exit(
      decodeSessionTurnDiff({
        sessionId: "session-1",
        fromTurnCount: 3,
        toTurnCount: 2,
        diff: "patch",
      }),
    );
    assert.strictEqual(result._tag, "Failure");
  }),
);

it.effect("trims branded ids and command string fields at decode boundaries", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeProjectCreateCommand({
      type: "project.create",
      commandId: " cmd-1 ",
      projectId: " project-1 ",
      title: " Project Title ",
      workspaceRoot: " /tmp/workspace ",
      defaultModelSelection: {
        provider: "codex",
        model: " gpt-5.2 ",
      },
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    assert.strictEqual(parsed.commandId, "cmd-1");
    assert.strictEqual(parsed.projectId, "project-1");
    assert.strictEqual(parsed.title, "Project Title");
    assert.strictEqual(parsed.workspaceRoot, "/tmp/workspace");
    assert.strictEqual(parsed.createWorkspaceRootIfMissing, undefined);
    assert.deepStrictEqual(parsed.defaultModelSelection, {
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-5.2",
    });
  }),
);

it.effect("decodes project.create with createWorkspaceRootIfMissing enabled", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeProjectCreateCommand({
      type: "project.create",
      commandId: "cmd-1",
      projectId: "project-1",
      title: "Project Title",
      workspaceRoot: "/tmp/workspace",
      createWorkspaceRootIfMissing: true,
      createdAt: "2026-01-01T00:00:00.000Z",
    });

    assert.strictEqual(parsed.createWorkspaceRootIfMissing, true);
  }),
);

it.effect("decodes historical project.created payloads with a default provider", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeProjectCreatedPayload({
      projectId: "project-1",
      title: "Project Title",
      workspaceRoot: "/tmp/workspace",
      defaultModelSelection: {
        provider: "codex",
        model: "gpt-5.4",
      },
      scripts: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    assert.strictEqual(parsed.defaultModelSelection?.instanceId, "codex");
  }),
);

it.effect("decodes project.meta-updated payloads with explicit default provider", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeProjectMetaUpdatedPayload({
      projectId: "project-1",
      defaultModelSelection: {
        provider: "claudeAgent",
        model: "claude-opus-4-6",
      },
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    assert.strictEqual(parsed.defaultModelSelection?.instanceId, "claudeAgent");
  }),
);

it.effect("rejects command fields that become empty after trim", () =>
  Effect.gen(function* () {
    const result = yield* Effect.exit(
      decodeProjectCreateCommand({
        type: "project.create",
        commandId: "cmd-1",
        projectId: "project-1",
        title: "  ",
        workspaceRoot: "/tmp/workspace",
        createdAt: "2026-01-01T00:00:00.000Z",
      }),
    );
    assert.strictEqual(result._tag, "Failure");
  }),
);

it.effect("decodes session.turn.start defaults for provider and runtime mode", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeSessionTurnStartCommand({
      type: "session.turn.start",
      commandId: "cmd-turn-1",
      sessionId: "session-1",
      message: {
        messageId: "msg-1",
        role: "user",
        text: "hello",
        attachments: [],
      },
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    assert.strictEqual(parsed.modelSelection, undefined);
    assert.strictEqual(parsed.runtimeMode, DEFAULT_RUNTIME_MODE);
    assert.strictEqual(parsed.interactionMode, DEFAULT_PROVIDER_INTERACTION_MODE);
  }),
);

it.effect("preserves explicit provider and runtime mode in session.turn.start", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeSessionTurnStartCommand({
      type: "session.turn.start",
      commandId: "cmd-turn-2",
      sessionId: "session-1",
      message: {
        messageId: "msg-2",
        role: "user",
        text: "hello",
        attachments: [],
      },
      modelSelection: {
        provider: "codex",
        model: "gpt-5.4",
      },
      runtimeMode: "full-access",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    assert.strictEqual(parsed.modelSelection?.instanceId, "codex");
    assert.strictEqual(parsed.runtimeMode, "full-access");
    assert.strictEqual(parsed.interactionMode, DEFAULT_PROVIDER_INTERACTION_MODE);
  }),
);

it.effect("accepts bootstrap metadata in session.turn.start", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeSessionTurnStartCommand({
      type: "session.turn.start",
      commandId: "cmd-turn-bootstrap",
      sessionId: "session-1",
      message: {
        messageId: "msg-bootstrap",
        role: "user",
        text: "hello",
        attachments: [],
      },
      bootstrap: {
        createSession: {
          projectId: "project-1",
          title: "Bootstrap session",
          modelSelection: {
            provider: "codex",
            model: "gpt-5.4",
          },
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          createdAt: "2026-01-01T00:00:00.000Z",
        },
        prepareWorktree: {
          projectCwd: "/tmp/workspace",
          baseBranch: "main",
          branch: "lincei/example",
        },
        runSetupScript: true,
      },
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    assert.strictEqual(parsed.bootstrap?.createSession?.projectId, "project-1");
    assert.strictEqual(parsed.bootstrap?.prepareWorktree?.baseBranch, "main");
    assert.strictEqual(parsed.bootstrap?.runSetupScript, true);
  }),
);

it.effect("decodes session.created runtime mode for historical events", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeSessionCreatedPayload({
      sessionId: "session-1",
      projectId: "project-1",
      title: "Session title",
      modelSelection: {
        provider: "codex",
        model: "gpt-5.4",
      },
      interactionMode: "default",
      branch: null,
      worktreePath: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    assert.strictEqual(parsed.runtimeMode, DEFAULT_RUNTIME_MODE);
    assert.strictEqual(parsed.modelSelection.instanceId, "codex");
  }),
);

it.effect("decodes session.meta-updated payloads with explicit provider", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeSessionMetaUpdatedPayload({
      sessionId: "session-1",
      modelSelection: {
        provider: "claudeAgent",
        model: "claude-opus-4-6",
      },
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    assert.strictEqual(parsed.modelSelection?.instanceId, "claudeAgent");
  }),
);

it.effect("decodes session archive and unarchive commands", () =>
  Effect.gen(function* () {
    const archive = yield* decodeOrchestrationCommand({
      type: "session.archive",
      commandId: "cmd-archive-1",
      sessionId: "session-1",
    });
    const unarchive = yield* decodeOrchestrationCommand({
      type: "session.unarchive",
      commandId: "cmd-unarchive-1",
      sessionId: "session-1",
    });

    assert.strictEqual(archive.type, "session.archive");
    assert.strictEqual(unarchive.type, "session.unarchive");
  }),
);

it.effect("decodes session archived and unarchived events", () =>
  Effect.gen(function* () {
    const archived = yield* decodeOrchestrationEvent({
      sequence: 1,
      eventId: "event-archive-1",
      aggregateKind: "session",
      aggregateId: "session-1",
      type: "session.archived",
      occurredAt: "2026-01-01T00:00:00.000Z",
      commandId: "cmd-archive-1",
      causationEventId: null,
      correlationId: "cmd-archive-1",
      metadata: {},
      payload: {
        sessionId: "session-1",
        archivedAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    });
    const unarchived = yield* decodeOrchestrationEvent({
      sequence: 2,
      eventId: "event-unarchive-1",
      aggregateKind: "session",
      aggregateId: "session-1",
      type: "session.unarchived",
      occurredAt: "2026-01-02T00:00:00.000Z",
      commandId: "cmd-unarchive-1",
      causationEventId: null,
      correlationId: "cmd-unarchive-1",
      metadata: {},
      payload: {
        sessionId: "session-1",
        updatedAt: "2026-01-02T00:00:00.000Z",
      },
    });

    assert.strictEqual(archived.type, "session.archived");
    assert.strictEqual(archived.payload.archivedAt, "2026-01-01T00:00:00.000Z");
    assert.strictEqual(unarchived.type, "session.unarchived");
  }),
);

it.effect("accepts provider-scoped model options in session.turn.start", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeSessionTurnStartCommand({
      type: "session.turn.start",
      commandId: "cmd-turn-options",
      sessionId: "session-1",
      message: {
        messageId: "msg-options",
        role: "user",
        text: "hello",
        attachments: [],
      },
      modelSelection: {
        provider: "codex",
        model: "gpt-5.3-codex",
        options: [
          { id: "reasoningEffort", value: "high" },
          { id: "fastMode", value: true },
        ],
      },
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    assert.strictEqual(parsed.modelSelection?.instanceId, "codex");
    assert.strictEqual(getOptionValue(parsed.modelSelection?.options, "reasoningEffort"), "high");
    assert.strictEqual(getOptionValue(parsed.modelSelection?.options, "fastMode"), true);
  }),
);

it.effect("normalizes legacy object-shaped modelSelection.options on decode", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeSessionCreatedPayload({
      sessionId: "session-1",
      projectId: "project-1",
      title: "Legacy options session",
      modelSelection: {
        provider: "claudeAgent",
        model: "claude-opus-4-6",
        options: {
          effort: "max",
          fastMode: true,
          // Falsy/garbage entries are dropped, matching migration 026.
          emptyStr: "   ",
          nullish: null,
          nested: { foo: 1 },
        },
      },
      branch: null,
      worktreePath: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    assert.strictEqual(parsed.modelSelection.instanceId, ProviderInstanceId.make("claudeAgent"));
    assert.deepStrictEqual(parsed.modelSelection.options, [
      { id: "effort", value: "max" },
      { id: "fastMode", value: true },
    ]);
  }),
);

it.effect("normalizes legacy object-shaped defaultModelSelection.options on decode", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeProjectCreatedPayload({
      projectId: "project-1",
      title: "Legacy default project",
      workspaceRoot: "/tmp/legacy",
      defaultModelSelection: {
        provider: "codex",
        model: "gpt-5.4",
        options: { reasoningEffort: "low" },
      },
      scripts: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    assert.deepStrictEqual(parsed.defaultModelSelection?.options, [
      { id: "reasoningEffort", value: "low" },
    ]);
  }),
);

it.effect(
  "normalizes legacy object-shaped options on decode and re-encodes as canonical array",
  () =>
    Effect.gen(function* () {
      const decoded = yield* decodeSessionCreatedPayload({
        sessionId: "session-1",
        projectId: "project-1",
        title: "Round trip session",
        modelSelection: {
          provider: "codex",
          model: "gpt-5.4",
          options: { fastMode: true },
        },
        branch: null,
        worktreePath: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      });

      const encoded = yield* encodeSessionCreatedPayload(decoded);
      assert.deepStrictEqual(encoded.modelSelection.options, [{ id: "fastMode", value: true }]);
    }),
);

it.effect("accepts a title seed in session.turn.start", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeSessionTurnStartCommand({
      type: "session.turn.start",
      commandId: "cmd-turn-title-seed",
      sessionId: "session-1",
      message: {
        messageId: "msg-title-seed",
        role: "user",
        text: "hello",
        attachments: [],
      },
      titleSeed: "Investigate reconnect failures",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    assert.strictEqual(parsed.titleSeed, "Investigate reconnect failures");
  }),
);

it.effect("accepts a source proposed plan reference in session.turn.start", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeSessionTurnStartCommand({
      type: "session.turn.start",
      commandId: "cmd-turn-source-plan",
      sessionId: "session-2",
      message: {
        messageId: "msg-source-plan",
        role: "user",
        text: "implement this",
        attachments: [],
      },
      sourceProposedPlan: {
        sessionId: "session-1",
        planId: "plan-1",
      },
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    assert.deepStrictEqual(parsed.sourceProposedPlan, {
      sessionId: "session-1",
      planId: "plan-1",
    });
  }),
);

it.effect(
  "decodes session.turn-start-requested defaults for provider, runtime mode, and interaction mode",
  () =>
    Effect.gen(function* () {
      const parsed = yield* decodeSessionTurnStartRequestedPayload({
        sessionId: "session-1",
        messageId: "msg-1",
        createdAt: "2026-01-01T00:00:00.000Z",
      });
      assert.strictEqual(parsed.modelSelection, undefined);
      assert.strictEqual(parsed.runtimeMode, DEFAULT_RUNTIME_MODE);
      assert.strictEqual(parsed.interactionMode, DEFAULT_PROVIDER_INTERACTION_MODE);
      assert.strictEqual(parsed.sourceProposedPlan, undefined);
    }),
);

it.effect("decodes session.turn-start-requested source proposed plan metadata when present", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeSessionTurnStartRequestedPayload({
      sessionId: "session-2",
      messageId: "msg-2",
      sourceProposedPlan: {
        sessionId: "session-1",
        planId: "plan-1",
      },
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    assert.deepStrictEqual(parsed.sourceProposedPlan, {
      sessionId: "session-1",
      planId: "plan-1",
    });
  }),
);

it.effect("decodes session.turn-start-requested title seed when present", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeSessionTurnStartRequestedPayload({
      sessionId: "session-2",
      messageId: "msg-2",
      titleSeed: "Investigate reconnect failures",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    assert.strictEqual(parsed.titleSeed, "Investigate reconnect failures");
  }),
);

it.effect("decodes latest turn source proposed plan metadata when present", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeOrchestrationLatestTurn({
      turnId: "turn-2",
      state: "running",
      requestedAt: "2026-01-01T00:00:00.000Z",
      startedAt: "2026-01-01T00:00:01.000Z",
      completedAt: null,
      assistantMessageId: null,
      sourceProposedPlan: {
        sessionId: "session-1",
        planId: "plan-1",
      },
    });
    assert.deepStrictEqual(parsed.sourceProposedPlan, {
      sessionId: "session-1",
      planId: "plan-1",
    });
  }),
);

it.effect("decodes orchestration session runtime mode defaults", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeOrchestrationProviderRuntime({
      sessionId: "session-1",
      status: "idle",
      providerName: null,
      activeTurnId: null,
      lastError: null,
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    assert.strictEqual(parsed.runtimeMode, DEFAULT_RUNTIME_MODE);
  }),
);

it.effect("defaults proposed plan implementation metadata for historical rows", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeOrchestrationProposedPlan({
      id: "plan-1",
      turnId: "turn-1",
      planMarkdown: "# Plan",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    assert.strictEqual(parsed.implementedAt, null);
    assert.strictEqual(parsed.implementationSessionId, null);
  }),
);

it.effect("preserves proposed plan implementation metadata when present", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeOrchestrationProposedPlan({
      id: "plan-2",
      turnId: "turn-2",
      planMarkdown: "# Plan",
      implementedAt: "2026-01-02T00:00:00.000Z",
      implementationSessionId: "session-2",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
    });
    assert.strictEqual(parsed.implementedAt, "2026-01-02T00:00:00.000Z");
    assert.strictEqual(parsed.implementationSessionId, "session-2");
  }),
);

it.effect("decodes a minimal proposed markdown research card", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeOrchestrationResearchCard({
      id: "card-1",
      type: "markdown",
      status: "proposed",
      title: "Eligibility summary",
      preview: {
        markdown: "Patients with baseline HbA1c available.",
      },
      turnId: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    assert.strictEqual(parsed.id, "card-1");
    assert.strictEqual(parsed.type, "markdown");
    assert.strictEqual(parsed.status, "proposed");
    assert.deepStrictEqual(parsed.artifacts, []);
    assert.deepStrictEqual(parsed.provenance, []);
  }),
);

it.effect("decodes a table research card with artifact references and provenance", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeOrchestrationResearchCard({
      id: "card-table-1",
      type: "table",
      status: "proposed",
      title: "Cohort counts by site",
      preview: {
        columns: ["site", "n"],
        rows: [["A", 42]],
      },
      artifacts: [
        {
          id: "artifact-csv-1",
          kind: "csv",
          path: "outputs/cohort-counts.csv",
          label: "Cohort counts CSV",
          mimeType: "text/csv",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
        {
          id: "artifact-sql-1",
          kind: "sql",
          path: "queries/cohort-counts.sql",
        },
      ],
      provenance: [
        {
          source: "ehr-extract",
          query: "select site, count(*) from cohort group by site",
          codeHash: "sha256:abc123",
          dataset: "diabetes-cohort-v1",
          timestamp: "2026-01-01T00:00:00.000Z",
        },
      ],
      turnId: "turn-1",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    assert.strictEqual(parsed.artifacts.length, 2);
    assert.strictEqual(parsed.artifacts[0]?.kind, "csv");
    assert.strictEqual(parsed.provenance[0]?.dataset, "diabetes-cohort-v1");
  }),
);

it.effect("defaults research cards for historical orchestration sessions", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeOrchestrationSession({
      id: "session-1",
      projectId: "project-1",
      title: "Historical session",
      modelSelection: {
        provider: "codex",
        model: "gpt-5.4",
      },
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: null,
      worktreePath: null,
      latestTurn: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      deletedAt: null,
      messages: [],
      proposedPlans: [],
      activities: [],
      checkpoints: [],
      session: null,
    });

    assert.deepStrictEqual(parsed.researchCards, []);
  }),
);

it.effect("decodes research card command shapes", () =>
  Effect.gen(function* () {
    const researchCard = {
      id: "card-1",
      type: "decision",
      status: "proposed",
      title: "Proceed to sensitivity analysis",
      review: {
        prompt: "Should this analysis be added?",
        actions: [
          { id: "accept", label: "Accept" },
          { id: "requestChanges", label: "Request changes", value: { requiresComment: true } },
        ],
      },
      turnId: "turn-1",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };

    const proposed = yield* decodeOrchestrationCommand({
      type: "session.research-card.propose",
      commandId: "cmd-card-propose",
      sessionId: "session-1",
      researchCard,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    const updated = yield* decodeOrchestrationCommand({
      type: "session.research-card.update",
      commandId: "cmd-card-update",
      sessionId: "session-1",
      cardId: "card-1",
      researchCard: {
        ...researchCard,
        status: "accepted",
        updatedAt: "2026-01-01T00:01:00.000Z",
      },
      createdAt: "2026-01-01T00:01:00.000Z",
    });
    const reviewed = yield* decodeOrchestrationCommand({
      type: "session.research-card.review",
      commandId: "cmd-card-review",
      sessionId: "session-1",
      cardId: "card-1",
      response: {
        action: "accept",
        message: "Use this as the primary sensitivity analysis.",
        values: { includeInManuscript: true },
        summary: "Accepted for manuscript inclusion",
        artifactId: "artifact-summary-1",
        timestamp: "2026-01-01T00:02:00.000Z",
      },
      createdAt: "2026-01-01T00:02:00.000Z",
    });

    assert.strictEqual(proposed.type, "session.research-card.propose");
    assert.strictEqual(updated.type, "session.research-card.update");
    assert.strictEqual(reviewed.type, "session.research-card.review");
  }),
);

it.effect("decodes research card event shapes", () =>
  Effect.gen(function* () {
    const researchCard = {
      id: "card-1",
      type: "markdown",
      status: "proposed",
      title: "Interim finding",
      turnId: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const eventBase = {
      aggregateKind: "session",
      aggregateId: "session-1",
      occurredAt: "2026-01-01T00:00:00.000Z",
      commandId: "cmd-card",
      causationEventId: null,
      correlationId: "cmd-card",
      metadata: {},
    };

    const proposed = yield* decodeOrchestrationEvent({
      ...eventBase,
      sequence: 1,
      eventId: "event-card-proposed",
      type: "session.research-card-proposed",
      payload: {
        sessionId: "session-1",
        researchCard,
      },
    });
    const updated = yield* decodeOrchestrationEvent({
      ...eventBase,
      sequence: 2,
      eventId: "event-card-updated",
      type: "session.research-card-updated",
      payload: {
        sessionId: "session-1",
        cardId: "card-1",
        researchCard: {
          ...researchCard,
          status: "changes-requested",
          updatedAt: "2026-01-01T00:01:00.000Z",
        },
      },
    });
    const reviewed = yield* decodeOrchestrationEvent({
      ...eventBase,
      sequence: 3,
      eventId: "event-card-reviewed",
      type: "session.research-card-reviewed",
      payload: {
        sessionId: "session-1",
        cardId: "card-1",
        response: {
          action: "requestChanges",
          message: "Add denominators before accepting.",
          timestamp: "2026-01-01T00:02:00.000Z",
        },
      },
    });

    assert.strictEqual(proposed.type, "session.research-card-proposed");
    assert.strictEqual(updated.type, "session.research-card-updated");
    assert.strictEqual(reviewed.type, "session.research-card-reviewed");
  }),
);

it.effect("rejects research card required fields that become empty after trim", () =>
  Effect.gen(function* () {
    const emptyCardId = yield* Effect.exit(
      decodeOrchestrationResearchCard({
        id: "  ",
        type: "markdown",
        status: "proposed",
        title: "Eligibility summary",
        turnId: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      }),
    );
    const emptyTitle = yield* Effect.exit(
      decodeOrchestrationResearchCard({
        id: "card-1",
        type: "markdown",
        status: "proposed",
        title: "  ",
        turnId: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      }),
    );
    const emptyArtifactId = yield* Effect.exit(
      decodeOrchestrationResearchCard({
        id: "card-1",
        type: "table",
        status: "proposed",
        title: "Cohort table",
        artifacts: [{ id: "  ", kind: "csv" }],
        turnId: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      }),
    );

    assert.strictEqual(emptyCardId._tag, "Failure");
    assert.strictEqual(emptyTitle._tag, "Failure");
    assert.strictEqual(emptyArtifactId._tag, "Failure");
  }),
);

// ── ModelSelection: instance-keyed wire shape + legacy decoder ────────
//
// `ModelSelection` is routing-keyed on `instanceId` — never a driver kind.
// Persisted and in-flight payloads from pre-instance builds carry a
// `provider` field whose value was a driver kind; those payloads are migrated
// at the wire boundary by
// promoting `provider` to the default instance id for that driver
// (built-in drivers use the driver kind slug as their default instance id, so
// the migration is a 1:1 rename).
//
// These tests pin the rollback/fork tolerance invariant: legacy payloads
// decode cleanly for fork-provided drivers, and the decoded form uses
// `instanceId` uniformly regardless of origin.

const decodeModelSelection = Schema.decodeUnknownEffect(ModelSelection);
const encodeModelSelection = Schema.encodeUnknownEffect(ModelSelection);

it.effect("ModelSelection migrates legacy `provider` field to `instanceId`", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeModelSelection({
      provider: "codex",
      model: "gpt-5-codex",
      options: [{ id: "reasoningEffort", value: "high" }],
    });
    assert.strictEqual(parsed.instanceId, ProviderInstanceId.make("codex"));
    assert.strictEqual(parsed.model, "gpt-5-codex");
    assert.deepStrictEqual(parsed.options, [{ id: "reasoningEffort", value: "high" }]);
  }),
);

it.effect("ModelSelection accepts an explicit instanceId routing key", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeModelSelection({
      instanceId: "codex_personal",
      model: "gpt-5-codex",
    });
    assert.strictEqual(parsed.instanceId, ProviderInstanceId.make("codex_personal"));
  }),
);

it.effect("ModelSelection prefers explicit instanceId over legacy provider", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeModelSelection({
      provider: "codex",
      instanceId: "codex_personal",
      model: "gpt-5-codex",
    });
    assert.strictEqual(parsed.instanceId, ProviderInstanceId.make("codex_personal"));
  }),
);

it.effect(
  "ModelSelection decodes unknown driver kinds via legacy provider (rollback / fork invariant)",
  () =>
    Effect.gen(function* () {
      const parsed = yield* decodeModelSelection({
        provider: "ollama",
        model: "llama3:70b",
        options: [{ id: "temperature", value: "0.4" }],
      });
      assert.strictEqual(parsed.instanceId, ProviderInstanceId.make("ollama"));
      assert.strictEqual(parsed.model, "llama3:70b");
    }),
);

it.effect("ModelSelection encodes to the canonical instanceId wire form", () =>
  Effect.gen(function* () {
    const decoded = yield* decodeModelSelection({
      provider: "ollama",
      model: "llama3:70b",
      options: [{ id: "temperature", value: "0.4" }],
    });
    const encoded = yield* encodeModelSelection(decoded);
    assert.deepStrictEqual(encoded, {
      instanceId: "ollama",
      model: "llama3:70b",
      options: [{ id: "temperature", value: "0.4" }],
    });
  }),
);

it.effect("ModelSelection rejects malformed instance ids", () =>
  Effect.gen(function* () {
    const result = yield* Effect.exit(
      decodeModelSelection({
        instanceId: "1invalid", // must start with a letter
        model: "x",
      }),
    );
    assert.strictEqual(result._tag, "Failure");
  }),
);
