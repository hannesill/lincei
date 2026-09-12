// @effect-diagnostics nodeBuiltinImport:off - Copy disposable fixtures produced by the Node test.
import { copyFileSync } from "node:fs";
// @effect-diagnostics nodeBuiltinImport:off - Resolve disposable cross-driver database paths.
import { join } from "node:path";
// @effect-diagnostics nodeBuiltinImport:off - Assert the real Bun driver results.
import assert from "node:assert/strict";
import * as SqliteClient from "@effect/sql-sqlite-bun/SqliteClient";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";

import { invalidMigrationHistoryCases } from "./Migrations.fixture.ts";
import { migrationEntries, runMigrations } from "./Migrations.ts";

const [seedPath, directory] = process.argv.slice(2);
if (seedPath === undefined || directory === undefined)
  throw new Error("Missing Node profile fixture");

await Effect.runPromise(
  Effect.gen(function* () {
    // Main's historical 031 throws during statement preparation under Bun. Test
    // history validation on real Node-created profiles without changing or replaying 031.
    for (const [index, testCase] of invalidMigrationHistoryCases.entries()) {
      const filename = join(directory, `invalid-${index}.sqlite`);
      copyFileSync(seedPath, filename);
      yield* testCase.run.pipe(Effect.provide(SqliteClient.layer({ filename })));
    }
    const filename = join(directory, "valid-upgrade.sqlite");
    copyFileSync(seedPath, filename);
    yield* Effect.gen(function* () {
      assert.deepEqual(
        yield* runMigrations(),
        migrationEntries.filter(([id]) => id > 35).map(([id, name]) => [id, name]),
      );
      assert.deepEqual(yield* runMigrations(), []);
    }).pipe(Effect.provide(SqliteClient.layer({ filename })));

    yield* Effect.gen(function* () {
      assert.deepEqual(
        yield* runMigrations({ toMigrationInclusive: 30 }),
        migrationEntries.filter(([id]) => id <= 30).map(([id, name]) => [id, name]),
      );
      assert.deepEqual(yield* runMigrations({ toMigrationInclusive: 30 }), []);
    }).pipe(Effect.provide(SqliteClient.layer({ filename: ":memory:" })));
    yield* Console.log(
      `Passed ${invalidMigrationHistoryCases.length + 2} Bun SQLite migration-history cases`,
    );
  }),
);
