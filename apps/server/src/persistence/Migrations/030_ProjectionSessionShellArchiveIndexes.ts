import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_sessions_shell_active
    ON projection_sessions(deleted_at, archived_at, project_id, created_at, session_id)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_sessions_shell_archived
    ON projection_sessions(deleted_at, archived_at, project_id, session_id)
  `;
});
