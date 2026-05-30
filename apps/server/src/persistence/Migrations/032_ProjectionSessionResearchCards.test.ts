import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("032_ProjectionSessionResearchCards", (it) => {
  it.effect("creates research card projection table and ordering index", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 31 });
      yield* runMigrations({ toMigrationInclusive: 32 });

      const tableRows = yield* sql<{ readonly name: string }>`
        SELECT name
        FROM sqlite_master
        WHERE type = 'table'
          AND name = 'projection_session_research_cards'
      `;
      assert.deepStrictEqual(tableRows, [{ name: "projection_session_research_cards" }]);

      const indexes = yield* sql<{ readonly name: string }>`
        PRAGMA index_list(projection_session_research_cards)
      `;
      assert.ok(
        indexes.some(
          (index) => index.name === "idx_projection_session_research_cards_session_created_id",
        ),
      );

      const indexColumns = yield* sql<{ readonly name: string }>`
        PRAGMA index_info('idx_projection_session_research_cards_session_created_id')
      `;
      assert.deepStrictEqual(
        indexColumns.map((column) => column.name),
        ["session_id", "created_at", "card_id"],
      );
    }),
  );
});
