import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as Effect from "effect/Effect";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS checkpoint_diff_blobs (
      session_id TEXT NOT NULL,
      from_turn_count INTEGER NOT NULL,
      to_turn_count INTEGER NOT NULL,
      diff TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (session_id, from_turn_count, to_turn_count)
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_checkpoint_diff_blobs_session_to_turn
    ON checkpoint_diff_blobs(session_id, to_turn_count)
  `;
});
