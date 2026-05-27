import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("016_CanonicalizeModelSelections", (it) => {
  it.effect(
    "migrates legacy projection rows and event payloads to the canonical model-selection shape",
    () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;

        // Setup base state
        {
          yield* runMigrations({ toMigrationInclusive: 15 });

          yield* sql`
        INSERT INTO projection_projects (
          project_id,
          title,
          workspace_root,
          default_model,
          scripts_json,
          created_at,
          updated_at,
          deleted_at
        )
        VALUES
          ('project-codex', 'Codex project', '/tmp/project-codex', 'gpt-5.4', '[]', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', NULL),
          ('project-claude', 'Claude project', '/tmp/project-claude', 'claude-sonnet-4-6', '[]', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', NULL),
          ('project-null', 'Null project', '/tmp/project-null', NULL, '[]', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', NULL)
      `;
          yield* sql`
        UPDATE projection_projects
        SET default_model = 'claude-opus-4-6'
        WHERE project_id = 'project-claude'
      `;
          yield* sql`
        INSERT INTO projection_sessions (
          session_id,
          project_id,
          title,
          model,
          branch,
          worktree_path,
          latest_turn_id,
          created_at,
          updated_at,
          deleted_at,
          runtime_mode,
          interaction_mode
        )
        VALUES
          ('session-session', 'project-codex', 'Session session', 'gpt-5.4', NULL, NULL, NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', NULL, 'full-access', 'default'),
          ('session-claude', 'project-claude', 'Claude session', 'claude-opus-4-6', NULL, NULL, NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', NULL, 'full-access', 'default'),
          ('session-codex', 'project-codex', 'Codex session', 'gpt-5.4', NULL, NULL, NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', NULL, 'full-access', 'default'),
          ('session-legacy-options', 'project-claude', 'Legacy options session', 'claude-opus-4-6', NULL, NULL, NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', NULL, 'full-access', 'default')
      `;
          yield* sql`
        INSERT INTO projection_session_sessions (
          session_id,
          status,
          provider_name,
          provider_session_id,
          active_turn_id,
          last_error,
          updated_at,
          runtime_mode
        )
        VALUES (
          'session-session',
          'running',
          'claudeAgent',
          'provider-session-1',
          NULL,
          NULL,
          '2026-01-01T00:00:00.000Z',
          'full-access'
        )
      `;
          yield* sql`
        INSERT INTO orchestration_events (
          event_id,
          aggregate_kind,
          stream_id,
          stream_version,
          event_type,
          occurred_at,
          command_id,
          causation_event_id,
          correlation_id,
          actor_kind,
          payload_json,
          metadata_json
        )
        VALUES
        (
          'event-project-created',
          'project',
          'project-1',
          1,
          'project.created',
          '2026-01-01T00:00:00.000Z',
          'command-project-created',
          NULL,
          'correlation-project-created',
          'user',
          '{"projectId":"project-1","title":"Project","workspaceRoot":"/tmp/project","defaultModel":"claude-opus-4-6","defaultModelOptions":{"codex":{"reasoningEffort":"high"},"claudeAgent":{"effort":"max"}},"scripts":[],"createdAt":"2026-01-01T00:00:00.000Z","updatedAt":"2026-01-01T00:00:00.000Z"}',
          '{}'
        ),
        (
          'event-project-created-fallback',
          'project',
          'project-2',
          1,
          'project.created',
          '2026-01-01T00:00:00.000Z',
          'command-project-created-fallback',
          NULL,
          'correlation-project-created-fallback',
          'user',
          '{"projectId":"project-2","title":"Fallback Project","workspaceRoot":"/tmp/project-2","defaultModel":"claude-opus-4-6","defaultModelOptions":{"codex":{"reasoningEffort":"low"}},"scripts":[],"createdAt":"2026-01-01T00:00:00.000Z","updatedAt":"2026-01-01T00:00:00.000Z"}',
          '{}'
        ),
        (
          'event-project-created-null-model',
          'project',
          'project-3',
          1,
          'project.created',
          '2026-01-01T00:00:00.000Z',
          'command-project-created-null-model',
          NULL,
          'correlation-project-created-null-model',
          'user',
          '{"projectId":"project-3","title":"Null Model Project","workspaceRoot":"/tmp/project-3","defaultModel":null,"scripts":[],"createdAt":"2026-01-01T00:00:00.000Z","updatedAt":"2026-01-01T00:00:00.000Z"}',
          '{}'
        ),
        (
          'event-session-created',
          'session',
          'session-1',
          1,
          'session.created',
          '2026-01-01T00:00:00.000Z',
          'command-session-created',
          NULL,
          'correlation-session-created',
          'user',
          '{"sessionId":"session-1","projectId":"project-1","title":"Session","model":"claude-opus-4-6","modelOptions":{"codex":{"reasoningEffort":"high"},"claudeAgent":{"effort":"max","thinking":false}},"runtimeMode":"full-access","interactionMode":"default","branch":null,"worktreePath":null,"createdAt":"2026-01-01T00:00:00.000Z","updatedAt":"2026-01-01T00:00:00.000Z"}',
          '{}'
        ),
        (
          'event-session-created-fallback',
          'session',
          'session-2',
          1,
          'session.created',
          '2026-01-01T00:00:00.000Z',
          'command-session-created-fallback',
          NULL,
          'correlation-session-created-fallback',
          'user',
          '{"sessionId":"session-2","projectId":"project-1","title":"Fallback Session","model":"gpt-5.4","modelOptions":{"claudeAgent":{"effort":"max"}},"runtimeMode":"full-access","interactionMode":"default","branch":null,"worktreePath":null,"createdAt":"2026-01-01T00:00:00.000Z","updatedAt":"2026-01-01T00:00:00.000Z"}',
          '{}'
        ),
        (
          'event-turn-start-requested',
          'session',
          'session-1',
          2,
          'session.turn-start-requested',
          '2026-01-01T00:00:00.000Z',
          'command-turn-start-requested',
          NULL,
          'correlation-turn-start-requested',
          'user',
          '{"sessionId":"session-1","turnId":"turn-1","input":"hi","model":"gpt-5.4","modelOptions":{"codex":{"fastMode":true},"claudeAgent":{"effort":"max"}},"deliveryMode":"buffered"}',
          '{}'
        ),
        (
          'event-session-created-no-model',
          'session',
          'session-3',
          1,
          'session.created',
          '2026-01-01T00:00:00.000Z',
          'command-session-created-no-model',
          NULL,
          'correlation-session-created-no-model',
          'user',
          '{"sessionId":"session-3","projectId":"project-1","title":"Ancient Session","runtimeMode":"full-access","interactionMode":"default","branch":null,"worktreePath":null,"createdAt":"2026-01-01T00:00:00.000Z","updatedAt":"2026-01-01T00:00:00.000Z"}',
          '{}'
        )
      `;
        }

        // Execute migration under test
        yield* runMigrations({ toMigrationInclusive: 16 });

        // Assert expected state
        {
          const projectRows = yield* sql<{
            readonly projectId: string;
            readonly defaultModelSelection: string | null;
          }>`
        SELECT
          project_id AS "projectId",
          default_model_selection_json AS "defaultModelSelection"
        FROM projection_projects
        ORDER BY project_id
      `;
          assert.deepStrictEqual(projectRows, [
            {
              projectId: "project-claude",
              defaultModelSelection: '{"provider":"claudeAgent","model":"claude-opus-4-6"}',
            },
            {
              projectId: "project-codex",
              defaultModelSelection: '{"provider":"codex","model":"gpt-5.4"}',
            },
            { projectId: "project-null", defaultModelSelection: null },
          ]);

          const sessionRows = yield* sql<{
            readonly sessionId: string;
            readonly modelSelection: string | null;
          }>`
        SELECT
          session_id AS "sessionId",
          model_selection_json AS "modelSelection"
        FROM projection_sessions
        ORDER BY session_id
      `;
          assert.deepStrictEqual(sessionRows, [
            {
              sessionId: "session-claude",
              modelSelection: '{"provider":"claudeAgent","model":"claude-opus-4-6"}',
            },
            {
              sessionId: "session-codex",
              modelSelection: '{"provider":"codex","model":"gpt-5.4"}',
            },
            {
              sessionId: "session-legacy-options",
              modelSelection: '{"provider":"claudeAgent","model":"claude-opus-4-6"}',
            },
            {
              sessionId: "session-session",
              modelSelection: '{"provider":"claudeAgent","model":"gpt-5.4"}',
            },
          ]);

          const eventRows = yield* sql<{
            readonly payloadJson: string;
          }>`
        SELECT payload_json AS "payloadJson"
        FROM orchestration_events
        ORDER BY rowid ASC
      `;
          // @effect-diagnostics-next-line preferSchemaOverJson:off
          assert.deepStrictEqual(JSON.parse(eventRows[0]!.payloadJson), {
            projectId: "project-1",
            title: "Project",
            workspaceRoot: "/tmp/project",
            defaultModelSelection: {
              provider: "claudeAgent",
              model: "claude-opus-4-6",
              options: {
                effort: "max",
              },
            },
            scripts: [],
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          });
          // @effect-diagnostics-next-line preferSchemaOverJson:off
          assert.deepStrictEqual(JSON.parse(eventRows[1]!.payloadJson), {
            projectId: "project-2",
            title: "Fallback Project",
            workspaceRoot: "/tmp/project-2",
            defaultModelSelection: {
              provider: "claudeAgent",
              model: "claude-opus-4-6",
              options: {
                reasoningEffort: "low",
              },
            },
            scripts: [],
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          });
          // @effect-diagnostics-next-line preferSchemaOverJson:off
          assert.deepStrictEqual(JSON.parse(eventRows[2]!.payloadJson), {
            projectId: "project-3",
            title: "Null Model Project",
            workspaceRoot: "/tmp/project-3",
            defaultModelSelection: null,
            scripts: [],
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          });
          // @effect-diagnostics-next-line preferSchemaOverJson:off
          assert.deepStrictEqual(JSON.parse(eventRows[3]!.payloadJson), {
            sessionId: "session-1",
            projectId: "project-1",
            title: "Session",
            modelSelection: {
              provider: "claudeAgent",
              model: "claude-opus-4-6",
              options: {
                effort: "max",
                thinking: false,
              },
            },
            runtimeMode: "full-access",
            interactionMode: "default",
            branch: null,
            worktreePath: null,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          });
          // @effect-diagnostics-next-line preferSchemaOverJson:off
          assert.deepStrictEqual(JSON.parse(eventRows[4]!.payloadJson), {
            sessionId: "session-2",
            projectId: "project-1",
            title: "Fallback Session",
            modelSelection: {
              provider: "codex",
              model: "gpt-5.4",
              options: {
                effort: "max",
              },
            },
            runtimeMode: "full-access",
            interactionMode: "default",
            branch: null,
            worktreePath: null,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          });
          // @effect-diagnostics-next-line preferSchemaOverJson:off
          assert.deepStrictEqual(JSON.parse(eventRows[5]!.payloadJson), {
            sessionId: "session-1",
            turnId: "turn-1",
            input: "hi",
            modelSelection: {
              provider: "codex",
              model: "gpt-5.4",
              options: {
                fastMode: true,
              },
            },
            deliveryMode: "buffered",
          });
          // @effect-diagnostics-next-line preferSchemaOverJson:off
          assert.deepStrictEqual(JSON.parse(eventRows[6]!.payloadJson), {
            sessionId: "session-3",
            projectId: "project-1",
            title: "Ancient Session",
            modelSelection: {
              provider: "codex",
              model: "gpt-5.4",
            },
            runtimeMode: "full-access",
            interactionMode: "default",
            branch: null,
            worktreePath: null,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          });
        }
      }),
  );
});
