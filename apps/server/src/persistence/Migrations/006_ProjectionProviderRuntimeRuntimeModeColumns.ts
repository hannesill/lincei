import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as Effect from "effect/Effect";

const DEFAULT_RUNTIME_MODE = "full-access";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
      ALTER TABLE projection_session_sessions
      ADD COLUMN runtime_mode TEXT NOT NULL DEFAULT 'full-access'
    `;

  yield* sql`
    UPDATE projection_session_sessions
    SET runtime_mode = ${DEFAULT_RUNTIME_MODE}
    WHERE runtime_mode IS NULL
  `;
});
