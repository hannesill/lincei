import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const ignoreMissing = <A, E>(effect: Effect.Effect<A, E>) =>
    effect.pipe(Effect.catch(() => Effect.void));

  yield* ignoreMissing(
    sql`ALTER TABLE checkpoint_diff_blobs RENAME COLUMN thread_id TO session_id`,
  );
  yield* ignoreMissing(sql`ALTER TABLE provider_session_runtime RENAME TO provider_runtime`);
  yield* ignoreMissing(sql`ALTER TABLE provider_runtime RENAME COLUMN thread_id TO session_id`);
  yield* ignoreMissing(sql`ALTER TABLE projection_threads RENAME TO projection_sessions`);
  yield* ignoreMissing(sql`ALTER TABLE projection_sessions RENAME COLUMN thread_id TO session_id`);
  yield* ignoreMissing(
    sql`ALTER TABLE projection_thread_messages RENAME TO projection_session_messages`,
  );
  yield* ignoreMissing(
    sql`ALTER TABLE projection_session_messages RENAME COLUMN thread_id TO session_id`,
  );
  yield* ignoreMissing(
    sql`ALTER TABLE projection_thread_activities RENAME TO projection_session_activities`,
  );
  yield* ignoreMissing(
    sql`ALTER TABLE projection_session_activities RENAME COLUMN thread_id TO session_id`,
  );
  yield* ignoreMissing(
    sql`ALTER TABLE projection_thread_sessions RENAME TO projection_session_sessions`,
  );
  yield* ignoreMissing(
    sql`ALTER TABLE projection_session_sessions RENAME COLUMN thread_id TO session_id`,
  );
  yield* ignoreMissing(
    sql`ALTER TABLE projection_thread_proposed_plans RENAME TO projection_session_proposed_plans`,
  );
  yield* ignoreMissing(
    sql`ALTER TABLE projection_session_proposed_plans RENAME COLUMN thread_id TO session_id`,
  );
  yield* ignoreMissing(
    sql`ALTER TABLE projection_session_proposed_plans RENAME COLUMN implementation_thread_id TO implementation_session_id`,
  );
  yield* ignoreMissing(sql`ALTER TABLE projection_turns RENAME COLUMN thread_id TO session_id`);
  yield* ignoreMissing(
    sql`ALTER TABLE projection_turns RENAME COLUMN source_proposed_plan_thread_id TO source_proposed_plan_session_id`,
  );
  yield* ignoreMissing(
    sql`ALTER TABLE projection_pending_approvals RENAME COLUMN thread_id TO session_id`,
  );

  yield* sql`
    UPDATE orchestration_events
    SET aggregate_kind = 'session'
    WHERE aggregate_kind = 'thread'
  `;

  yield* sql`
    UPDATE orchestration_events
    SET event_type = 'session.' || substr(event_type, length('thread.') + 1)
    WHERE event_type LIKE 'thread.%'
  `;

  yield* sql`
    UPDATE orchestration_events
    SET payload_json = json_remove(
      json_set(payload_json, '$.sessionId', json_extract(payload_json, '$.threadId')),
      '$.threadId'
    )
    WHERE json_type(payload_json, '$.threadId') IS NOT NULL
  `;

  yield* sql`
    UPDATE orchestration_events
    SET payload_json = json_remove(
      json_set(
        payload_json,
        '$.sourceProposedPlan.sessionId',
        json_extract(payload_json, '$.sourceProposedPlan.threadId')
      ),
      '$.sourceProposedPlan.threadId'
    )
    WHERE json_type(payload_json, '$.sourceProposedPlan.threadId') IS NOT NULL
  `;

  yield* sql`
    UPDATE orchestration_events
    SET payload_json = json_remove(
      json_set(payload_json, '$.session.sessionId', json_extract(payload_json, '$.session.threadId')),
      '$.session.threadId'
    )
    WHERE json_type(payload_json, '$.session.threadId') IS NOT NULL
  `;

  yield* sql`
    UPDATE orchestration_events
    SET payload_json = json_remove(
      json_set(
        payload_json,
        '$.proposedPlan.implementationSessionId',
        json_extract(payload_json, '$.proposedPlan.implementationThreadId')
      ),
      '$.proposedPlan.implementationThreadId'
    )
    WHERE json_type(payload_json, '$.proposedPlan.implementationThreadId') IS NOT NULL
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_checkpoint_diff_blobs_session_to_turn
    ON checkpoint_diff_blobs(session_id, to_turn_count)
  `.pipe(Effect.catch(() => Effect.void));

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_provider_runtime_status
    ON provider_runtime(status)
  `.pipe(Effect.catch(() => Effect.void));

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_provider_runtime_provider
    ON provider_runtime(provider_name)
  `.pipe(Effect.catch(() => Effect.void));

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_provider_runtime_instance
    ON provider_runtime(provider_instance_id)
  `.pipe(Effect.catch(() => Effect.void));

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_sessions_project_id
    ON projection_sessions(project_id)
  `.pipe(Effect.catch(() => Effect.void));

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_session_messages_session_created
    ON projection_session_messages(session_id, created_at)
  `.pipe(Effect.catch(() => Effect.void));

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_session_messages_session_created_id
    ON projection_session_messages(session_id, created_at, message_id)
  `.pipe(Effect.catch(() => Effect.void));

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_session_activities_session_created
    ON projection_session_activities(session_id, created_at)
  `.pipe(Effect.catch(() => Effect.void));

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_session_activities_session_sequence
    ON projection_session_activities(session_id, sequence)
  `.pipe(Effect.catch(() => Effect.void));

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_session_activities_session_sequence_created_id
    ON projection_session_activities(session_id, sequence, created_at, activity_id)
  `.pipe(Effect.catch(() => Effect.void));

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_session_sessions_provider_session
    ON projection_session_sessions(provider_session_id)
  `.pipe(Effect.catch(() => Effect.void));

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_session_sessions_instance
    ON projection_session_sessions(provider_instance_id)
  `.pipe(Effect.catch(() => Effect.void));

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_session_proposed_plans_session_created
    ON projection_session_proposed_plans(session_id, created_at)
  `.pipe(Effect.catch(() => Effect.void));

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_turns_session_requested
    ON projection_turns(session_id, requested_at)
  `.pipe(Effect.catch(() => Effect.void));

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_turns_session_checkpoint_completed
    ON projection_turns(session_id, checkpoint_turn_count, completed_at)
  `.pipe(Effect.catch(() => Effect.void));

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_pending_approvals_session_status
    ON projection_pending_approvals(session_id, status)
  `.pipe(Effect.catch(() => Effect.void));

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_sessions_project_archived_at
    ON projection_sessions(project_id, archived_at)
  `.pipe(Effect.catch(() => Effect.void));

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_sessions_shell_active
    ON projection_sessions(deleted_at, archived_at, project_id, created_at, session_id)
  `.pipe(Effect.catch(() => Effect.void));

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_sessions_shell_archived
    ON projection_sessions(deleted_at, archived_at, project_id, session_id)
  `.pipe(Effect.catch(() => Effect.void));
});
