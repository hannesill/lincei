// @effect-diagnostics nodeBuiltinImport:off - Shared assertions run under Node and Bun SQLite.
import assert from "node:assert/strict";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { migrationEntries, runMigrations } from "./Migrations.ts";

const snapshot = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const schema = yield* sql<{ readonly name: string; readonly type: string; readonly sql: string }>`
    SELECT name, type, sql FROM sqlite_schema ORDER BY type, name
  `;
  const history = schema.some((row) => row.name === "effect_sql_migrations")
    ? yield* sql`SELECT * FROM effect_sql_migrations ORDER BY migration_id, name`
    : [];
  const data = yield* sql`SELECT payload FROM history_validation_sentinel`;
  return { schema, history, data };
});

const assertRejectedWithoutWrites = <E>(
  mutation: Effect.Effect<void, E, SqlClient.SqlClient>,
  expected: RegExp,
  toMigrationInclusive?: number,
) =>
  Effect.gen(function* () {
    yield* runMigrations({ toMigrationInclusive: 35 });
    const sql = yield* SqlClient.SqlClient;
    yield* sql`CREATE TABLE history_validation_sentinel (payload TEXT NOT NULL)`;
    yield* sql`INSERT INTO history_validation_sentinel VALUES ('preserve this data')`;
    yield* mutation;
    const before = yield* snapshot;
    const exit = yield* Effect.exit(runMigrations({ toMigrationInclusive }));
    assert.ok(Exit.isFailure(exit), "Expected incompatible migration history to be rejected");
    assert.match(Cause.pretty(exit.cause), expected);
    assert.deepEqual(yield* snapshot, before, "Rejected upgrades must not modify the database");
  });

export const freshMigrationHistoryCases = [
  {
    name: "migrates a fresh database and preserves completed history on repeated startup",
    run: Effect.gen(function* () {
      const expected = migrationEntries.map(([id, name]) => [id, name]);
      assert.deepEqual(yield* runMigrations(), expected);
      assert.deepEqual(yield* runMigrations(), []);
      assert.deepEqual(yield* runMigrations({ toMigrationInclusive: 30 }), []);
    }),
  },
  {
    name: "upgrades a valid prefix including the historical no-op migration",
    run: Effect.gen(function* () {
      yield* runMigrations({ toMigrationInclusive: 30 });
      assert.deepEqual(
        yield* runMigrations({ toMigrationInclusive: 32 }),
        migrationEntries.filter(([id]) => id > 30 && id <= 32).map(([id, name]) => [id, name]),
      );
      assert.deepEqual(
        yield* runMigrations(),
        migrationEntries.filter(([id]) => id > 32).map(([id, name]) => [id, name]),
      );
    }),
  },
] as const;

export const invalidMigrationHistoryCases = [
  {
    name: "rejects a missing middle migration before running the pending upgrade",
    run: assertRejectedWithoutWrites(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`DELETE FROM effect_sql_migrations WHERE migration_id = 20`;
      }),
      /missing.*20_AuthAccessManagement/,
    ),
  },
  {
    name: "requires the no-op migration record even when requesting an earlier cutoff",
    run: assertRejectedWithoutWrites(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`DELETE FROM effect_sql_migrations WHERE migration_id = 32`;
      }),
      /missing.*32_ProjectionSessionResearchCards/,
      30,
    ),
  },
  {
    name: "rejects an incompatible name on a reused historical migration ID",
    run: assertRejectedWithoutWrites(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`UPDATE effect_sql_migrations SET name = 'HashAuthPairingCredentials' WHERE migration_id = 34`;
      }),
      /34.*HashAuthPairingCredentials.*ProjectionSessionsSettled/,
    ),
  },
  {
    name: "rejects a migration from a newer or incompatible build",
    run: assertRejectedWithoutWrites(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`INSERT INTO effect_sql_migrations (migration_id, name) VALUES (37, 'HashAuthPairingCredentials')`;
      }),
      /unknown.*37/,
    ),
  },
  {
    name: "rejects duplicate records in a malformed history table",
    run: assertRejectedWithoutWrites(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`CREATE TABLE malformed_history AS SELECT * FROM effect_sql_migrations`;
        yield* sql`INSERT INTO malformed_history SELECT * FROM effect_sql_migrations WHERE migration_id = 20`;
        yield* sql`DROP TABLE effect_sql_migrations`;
        yield* sql`ALTER TABLE malformed_history RENAME TO effect_sql_migrations`;
      }),
      /duplicate.*20/,
    ),
  },
  {
    name: "rejects deleted history instead of treating an existing database as fresh",
    run: assertRejectedWithoutWrites(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`DELETE FROM effect_sql_migrations`;
      }),
      /no recorded migration history.*existing tables/,
    ),
  },
  {
    name: "rejects a missing history table without recreating it",
    run: assertRejectedWithoutWrites(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`DROP TABLE effect_sql_migrations`;
      }),
      /no recorded migration history.*existing tables/,
    ),
  },
] as const;
