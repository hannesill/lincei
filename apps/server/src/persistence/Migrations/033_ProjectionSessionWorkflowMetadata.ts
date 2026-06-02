import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const columns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_sessions)
  `;
  const columnNames = new Set(columns.map((column) => column.name));

  if (!columnNames.has("workflow_id")) {
    yield* sql`
      ALTER TABLE projection_sessions
      ADD COLUMN workflow_id TEXT
    `;
  }

  if (!columnNames.has("workflow_version")) {
    yield* sql`
      ALTER TABLE projection_sessions
      ADD COLUMN workflow_version TEXT
    `;
  }
});
