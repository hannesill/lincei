import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";
import Migration034 from "./034_ProjectionSessionsSettled.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

const insertRepresentativeSession = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    INSERT INTO projection_sessions (
      session_id,
      project_id,
      title,
      model_selection_json,
      runtime_mode,
      interaction_mode,
      branch,
      worktree_path,
      latest_turn_id,
      created_at,
      updated_at,
      archived_at,
      latest_user_message_at,
      pending_approval_count,
      pending_user_input_count,
      has_actionable_proposed_plan,
      deleted_at
    )
    VALUES (
      'session-lifecycle',
      'project-lifecycle',
      'Lifecycle session',
      '{"instanceId":"codex","model":"gpt-5.4"}',
      'full-access',
      'default',
      'feature/lifecycle',
      '/tmp/lifecycle',
      NULL,
      '2026-07-01T00:00:00.000Z',
      '2026-07-02T00:00:00.000Z',
      '2026-07-03T00:00:00.000Z',
      '2026-07-02T00:00:00.000Z',
      0,
      0,
      0,
      NULL
    )
  `;
});

layer("034_ProjectionSessionsSettled", (it) => {
  it.effect("upgrades 033 rows without changing archive state", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 33 });
      yield* sql`
        DELETE FROM projection_sessions
        WHERE session_id = 'session-lifecycle'
      `;
      yield* insertRepresentativeSession;
      yield* runMigrations({ toMigrationInclusive: 34 });

      const rows = yield* sql<{
        readonly archivedAt: string | null;
        readonly settledOverride: string | null;
        readonly settledAt: string | null;
        readonly title: string;
      }>`
        SELECT
          archived_at AS "archivedAt",
          settled_override AS "settledOverride",
          settled_at AS "settledAt",
          title
        FROM projection_sessions
        WHERE session_id = 'session-lifecycle'
      `;
      assert.deepStrictEqual(rows, [
        {
          archivedAt: "2026-07-03T00:00:00.000Z",
          settledOverride: null,
          settledAt: null,
          title: "Lifecycle session",
        },
      ]);

      const migrations = yield* sql<{ readonly migration_id: number; readonly name: string }>`
        SELECT migration_id, name
        FROM effect_sql_migrations
        WHERE migration_id >= 33
        ORDER BY migration_id
      `;
      assert.deepStrictEqual(migrations, [
        { migration_id: 33, name: "ProjectionSessionWorkflowMetadata" },
        { migration_id: 34, name: "ProjectionSessionsSettled" },
      ]);
    }),
  );

  it.effect("is idempotent and preserves populated lifecycle columns", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 33 });
      yield* sql`
        DELETE FROM projection_sessions
        WHERE session_id = 'session-lifecycle'
      `;
      yield* insertRepresentativeSession;
      yield* Migration034;
      yield* sql`
        UPDATE projection_sessions
        SET
          settled_override = 'settled',
          settled_at = '2026-07-04T00:00:00.000Z'
        WHERE session_id = 'session-lifecycle'
      `;
      yield* Migration034;

      const lifecycleColumns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(projection_sessions)
      `;
      assert.equal(
        lifecycleColumns.filter((column) => column.name === "settled_override").length,
        1,
      );
      assert.equal(lifecycleColumns.filter((column) => column.name === "settled_at").length, 1);

      const rows = yield* sql<{
        readonly archivedAt: string | null;
        readonly settledOverride: string | null;
        readonly settledAt: string | null;
      }>`
        SELECT
          archived_at AS "archivedAt",
          settled_override AS "settledOverride",
          settled_at AS "settledAt"
        FROM projection_sessions
        WHERE session_id = 'session-lifecycle'
      `;
      assert.deepStrictEqual(rows, [
        {
          archivedAt: "2026-07-03T00:00:00.000Z",
          settledOverride: "settled",
          settledAt: "2026-07-04T00:00:00.000Z",
        },
      ]);
    }),
  );
});
