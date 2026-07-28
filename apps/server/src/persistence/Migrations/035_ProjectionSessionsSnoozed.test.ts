import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";
import Migration035 from "./035_ProjectionSessionsSnoozed.ts";

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
      'session-snoozed-lifecycle',
      'project-snoozed-lifecycle',
      'Snoozed lifecycle session',
      '{"instanceId":"codex","model":"gpt-5.4"}',
      'full-access',
      'default',
      'feature/snoozed-lifecycle',
      '/tmp/snoozed-lifecycle',
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

it.layer(NodeSqliteClient.layerMemory())("035_ProjectionSessionsSnoozed upgrade", (it) => {
  it.effect("upgrades 033 through settled then snoozed without changing archive state", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 33 });
      yield* insertRepresentativeSession;
      yield* runMigrations({ toMigrationInclusive: 35 });

      const rows = yield* sql<{
        readonly archivedAt: string | null;
        readonly settledOverride: string | null;
        readonly settledAt: string | null;
        readonly snoozedUntil: string | null;
        readonly snoozedAt: string | null;
      }>`
        SELECT
          archived_at AS "archivedAt",
          settled_override AS "settledOverride",
          settled_at AS "settledAt",
          snoozed_until AS "snoozedUntil",
          snoozed_at AS "snoozedAt"
        FROM projection_sessions
        WHERE session_id = 'session-snoozed-lifecycle'
      `;
      assert.deepStrictEqual(rows, [
        {
          archivedAt: "2026-07-03T00:00:00.000Z",
          settledOverride: null,
          settledAt: null,
          snoozedUntil: null,
          snoozedAt: null,
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
        { migration_id: 35, name: "ProjectionSessionsSnoozed" },
      ]);
    }),
  );
});

it.layer(NodeSqliteClient.layerMemory())("035_ProjectionSessionsSnoozed idempotency", (it) => {
  it.effect("preserves populated archive, settled, and snoozed lifecycle columns", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 34 });
      yield* insertRepresentativeSession;
      yield* sql`
        UPDATE projection_sessions
        SET
          settled_override = 'settled',
          settled_at = '2026-07-04T00:00:00.000Z'
        WHERE session_id = 'session-snoozed-lifecycle'
      `;
      yield* Migration035;
      yield* sql`
        UPDATE projection_sessions
        SET
          snoozed_until = '2026-07-06T00:00:00.000Z',
          snoozed_at = '2026-07-05T00:00:00.000Z'
        WHERE session_id = 'session-snoozed-lifecycle'
      `;
      yield* Migration035;
      yield* Migration035;

      const lifecycleColumns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(projection_sessions)
      `;
      assert.equal(lifecycleColumns.filter((column) => column.name === "snoozed_until").length, 1);
      assert.equal(lifecycleColumns.filter((column) => column.name === "snoozed_at").length, 1);

      const rows = yield* sql<{
        readonly archivedAt: string | null;
        readonly settledOverride: string | null;
        readonly settledAt: string | null;
        readonly snoozedUntil: string | null;
        readonly snoozedAt: string | null;
      }>`
        SELECT
          archived_at AS "archivedAt",
          settled_override AS "settledOverride",
          settled_at AS "settledAt",
          snoozed_until AS "snoozedUntil",
          snoozed_at AS "snoozedAt"
        FROM projection_sessions
        WHERE session_id = 'session-snoozed-lifecycle'
      `;
      assert.deepStrictEqual(rows, [
        {
          archivedAt: "2026-07-03T00:00:00.000Z",
          settledOverride: "settled",
          settledAt: "2026-07-04T00:00:00.000Z",
          snoozedUntil: "2026-07-06T00:00:00.000Z",
          snoozedAt: "2026-07-05T00:00:00.000Z",
        },
      ]);
    }),
  );
});
