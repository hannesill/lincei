import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const columns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_sessions)
  `;

  if (columns.some((column) => column.name === "archived_at")) {
    return;
  }

  yield* sql`
    ALTER TABLE projection_sessions
    ADD COLUMN archived_at TEXT
  `;
});
