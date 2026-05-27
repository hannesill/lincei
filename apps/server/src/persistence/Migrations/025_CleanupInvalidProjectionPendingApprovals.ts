import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as Effect from "effect/Effect";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    DELETE FROM projection_pending_approvals
    WHERE NOT EXISTS (
      SELECT 1
      FROM projection_session_activities AS activity
      WHERE activity.kind = 'approval.requested'
        AND json_extract(activity.payload_json, '$.requestId')
          = projection_pending_approvals.request_id
    )
  `;

  yield* sql`
    UPDATE projection_sessions
    SET pending_approval_count = COALESCE((
      SELECT COUNT(*)
      FROM projection_pending_approvals
      WHERE projection_pending_approvals.session_id = projection_sessions.session_id
        AND projection_pending_approvals.status = 'pending'
    ), 0)
  `;
});
