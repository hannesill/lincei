import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_projects_workspace_root_deleted_at
    ON projection_projects(workspace_root, deleted_at)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_sessions_project_deleted_created
    ON projection_sessions(project_id, deleted_at, created_at)
  `;
});
