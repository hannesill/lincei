import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_session_activities_session_sequence_created_id
    ON projection_session_activities(session_id, sequence, created_at, activity_id)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_session_messages_session_created_id
    ON projection_session_messages(session_id, created_at, message_id)
  `;
});
