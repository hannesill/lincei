import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * Activity `sequence` now stores orchestration event order, and an approval
 * remains pending until provider confirmation. Clear only the derived rows
 * affected by those semantic changes and rewind their projectors so startup
 * replay deterministically rebuilds them from the event store. The sessions
 * projector stays at head; a versioned marker triggers one summary rebuild
 * after activity replay instead of rescanning full session history per event.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const sessionColumns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_sessions)
  `;
  const sessionColumnNames = new Set(sessionColumns.map((column) => column.name));
  if (!sessionColumnNames.has("pending_request_raised_at")) {
    yield* sql`
      ALTER TABLE projection_sessions
      ADD COLUMN pending_request_raised_at TEXT
    `;
  }

  const activityColumns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_session_activities)
  `;
  const activityColumnNames = new Set(activityColumns.map((column) => column.name));
  if (!activityColumnNames.has("event_occurred_at")) {
    yield* sql`
      ALTER TABLE projection_session_activities
      ADD COLUMN event_occurred_at TEXT
    `;
  }

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
      'projection.session-lifecycle-summary-v36'
    )
  `;
});
