// @effect-diagnostics nodeBuiltinImport:off - Cross-driver coverage launches the Bun fixture.
import { spawnSync } from "node:child_process";
// @effect-diagnostics nodeBuiltinImport:off - Own disposable cross-driver database fixtures.
import { mkdtempSync, rmSync } from "node:fs";
// @effect-diagnostics nodeBuiltinImport:off - Locate disposable cross-driver database fixtures.
import { tmpdir } from "node:os";
// @effect-diagnostics nodeBuiltinImport:off - Resolve disposable cross-driver database paths.
import { join } from "node:path";
// @effect-diagnostics nodeBuiltinImport:off - Resolve the fixture independently of the working directory.
import { fileURLToPath } from "node:url";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { freshMigrationHistoryCases, invalidMigrationHistoryCases } from "./Migrations.fixture.ts";
import { runMigrations } from "./Migrations.ts";
import * as NodeSqliteClient from "./NodeSqliteClient.ts";

for (const testCase of [...freshMigrationHistoryCases, ...invalidMigrationHistoryCases]) {
  it.effect(testCase.name, () => testCase.run.pipe(Effect.provide(NodeSqliteClient.layerMemory())));
}

it.effect("enforces migration-history rules under Bun SQLite on official Node profiles", () =>
  Effect.gen(function* () {
    const directory = yield* Effect.acquireRelease(
      Effect.sync(() => mkdtempSync(join(tmpdir(), "lincei-migration-history-"))),
      (directory) => Effect.sync(() => rmSync(directory, { recursive: true, force: true })),
    );
    const seedPath = join(directory, "official-035.sqlite");
    yield* runMigrations({ toMigrationInclusive: 35 }).pipe(
      Effect.provide(NodeSqliteClient.layer({ filename: seedPath })),
    );
    const result = spawnSync(
      "bun",
      [fileURLToPath(new URL("./Migrations.bun-fixture.ts", import.meta.url)), seedPath, directory],
      { encoding: "utf8", timeout: 30_000 },
    );
    assert.equal(
      result.status,
      0,
      `${result.error?.message ?? ""}\n${result.stdout}\n${result.stderr}`,
    );
    assert.include(
      result.stdout,
      `Passed ${invalidMigrationHistoryCases.length + 2} Bun SQLite migration-history cases`,
    );
  }).pipe(Effect.scoped),
);
