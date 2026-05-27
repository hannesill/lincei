import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    ALTER TABLE projection_session_activities
    ADD COLUMN sequence INTEGER
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_session_activities_session_sequence
    ON projection_session_activities(session_id, sequence)
  `;
});
