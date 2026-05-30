import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS projection_session_research_cards (
      card_id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      turn_id TEXT,
      type TEXT NOT NULL,
      status TEXT NOT NULL,
      title TEXT NOT NULL,
      preview_json TEXT,
      artifacts_json TEXT NOT NULL,
      provenance_json TEXT NOT NULL,
      review_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_session_research_cards_session_created_id
    ON projection_session_research_cards(session_id, created_at, card_id)
  `;
});
