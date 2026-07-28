import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * Activity `sequence` now stores orchestration event order, and an approval
 * remains pending until provider confirmation. Clear only the derived rows
 * affected by those semantic changes and rewind their projectors so startup
 * replay deterministically rebuilds them from the event store.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    DELETE FROM projection_session_activities
  `;
  yield* sql`
    DELETE FROM projection_pending_approvals
  `;
  yield* sql`
    DELETE FROM projection_state
    WHERE projector IN (
      'projection.session-activities',
      'projection.pending-approvals',
      'projection.sessions'
    )
  `;
});
