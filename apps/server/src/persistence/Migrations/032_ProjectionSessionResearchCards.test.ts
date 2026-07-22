import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("032_ProjectionSessionResearchCards", (it) => {
  it.effect("records the historical migration without creating a card table", () =>
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
      assert.deepStrictEqual(tableRows, []);

      const migrations = yield* sql<{ readonly migration_id: number; readonly name: string }>`
        SELECT migration_id, name
        FROM effect_sql_migrations
        WHERE migration_id = 32
      `;
      assert.deepStrictEqual(migrations, [
        { migration_id: 32, name: "ProjectionSessionResearchCards" },
      ]);
    }),
  );

  it.effect("leaves an existing legacy card table and its data dormant", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 32 });
      yield* sql`
        CREATE TABLE projection_session_research_cards (
          card_id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          title TEXT NOT NULL
        )
      `;
      yield* sql`
        INSERT INTO projection_session_research_cards (card_id, session_id, title)
        VALUES ('legacy-card', 'legacy-session', 'Preserved card')
      `;

      yield* runMigrations();

      const rows = yield* sql<{
        readonly cardId: string;
        readonly sessionId: string;
        readonly title: string;
      }>`
        SELECT
          card_id AS "cardId",
          session_id AS "sessionId",
          title
        FROM projection_session_research_cards
      `;
      assert.deepStrictEqual(rows, [
        {
          cardId: "legacy-card",
          sessionId: "legacy-session",
          title: "Preserved card",
        },
      ]);
    }),
  );
});
