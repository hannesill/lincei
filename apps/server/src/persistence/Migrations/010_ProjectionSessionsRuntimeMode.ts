import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    ALTER TABLE projection_sessions
    ADD COLUMN runtime_mode TEXT NOT NULL DEFAULT 'full-access'
  `;

  yield* sql`
    UPDATE projection_sessions
    SET runtime_mode = 'full-access'
    WHERE runtime_mode IS NULL
  `;
});
