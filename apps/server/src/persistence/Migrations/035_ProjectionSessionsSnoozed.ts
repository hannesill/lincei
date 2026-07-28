import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const columns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_sessions)
  `;
  const columnNames = new Set(columns.map((column) => column.name));

  if (!columnNames.has("snoozed_until")) {
    yield* sql`
      ALTER TABLE projection_sessions
      ADD COLUMN snoozed_until TEXT
    `;
  }

  if (!columnNames.has("snoozed_at")) {
    yield* sql`
      ALTER TABLE projection_sessions
      ADD COLUMN snoozed_at TEXT
    `;
  }
});
