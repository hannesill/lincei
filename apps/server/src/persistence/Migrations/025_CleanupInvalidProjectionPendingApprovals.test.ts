import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("025_CleanupInvalidProjectionPendingApprovals", (it) => {
  it.effect("removes pending-approval rows that do not come from approval requests", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 24 });

      yield* sql`
        INSERT INTO projection_sessions (
          session_id,
          project_id,
          title,
          model_selection_json,
          runtime_mode,
          interaction_mode,
          branch,
          worktree_path,
          latest_turn_id,
          created_at,
          updated_at,
          archived_at,
          latest_user_message_at,
          pending_approval_count,
          pending_user_input_count,
          has_actionable_proposed_plan,
          deleted_at
        )
        VALUES
          (
            'session-valid',
            'project-1',
            'Valid session',
            '{"provider":"codex","model":"gpt-5-codex"}',
            'approval-required',
            'default',
            NULL,
            NULL,
            'turn-valid',
            '2026-04-13T00:00:00.000Z',
            '2026-04-13T00:00:00.000Z',
            NULL,
            NULL,
            2,
            0,
            0,
            NULL
          ),
          (
            'session-invalid',
            'project-1',
            'Invalid session',
            '{"provider":"codex","model":"gpt-5-codex"}',
            'approval-required',
            'default',
            NULL,
            NULL,
            'turn-invalid',
            '2026-04-13T00:00:00.000Z',
            '2026-04-13T00:00:00.000Z',
            NULL,
            NULL,
            1,
            0,
            0,
            NULL
          )
      `;

      yield* sql`
        INSERT INTO projection_session_activities (
          activity_id,
          session_id,
          turn_id,
          tone,
          kind,
          summary,
          payload_json,
          sequence,
          created_at
        )
        VALUES
          (
            'activity-approval-requested',
            'session-valid',
            'turn-valid',
            'approval',
            'approval.requested',
            'Command approval requested',
            '{"requestId":"approval-valid","requestKind":"command"}',
            NULL,
            '2026-04-13T00:01:00.000Z'
          ),
          (
            'activity-user-input-requested',
            'session-invalid',
            'turn-invalid',
            'info',
            'user-input.requested',
            'User input requested',
            '{"requestId":"input-invalid","questions":[{"id":"scope","header":"Scope","question":"What should I inspect?","options":[{"label":"Server","description":"Inspect server code."}]}]}',
            NULL,
            '2026-04-13T00:02:00.000Z'
          )
      `;

      yield* sql`
        INSERT INTO projection_pending_approvals (
          request_id,
          session_id,
          turn_id,
          status,
          decision,
          created_at,
          resolved_at
        )
        VALUES
          (
            'approval-valid',
            'session-valid',
            'turn-valid',
            'pending',
            NULL,
            '2026-04-13T00:01:00.000Z',
            NULL
          ),
          (
            'input-invalid',
            'session-invalid',
            'turn-invalid',
            'pending',
            NULL,
            '2026-04-13T00:02:00.000Z',
            NULL
          ),
          (
            'input-invalid-resolved',
            'session-valid',
            'turn-valid',
            'resolved',
            NULL,
            '2026-04-13T00:03:00.000Z',
            '2026-04-13T00:04:00.000Z'
          )
      `;

      yield* runMigrations({ toMigrationInclusive: 25 });

      const approvalRows = yield* sql<{
        readonly requestId: string;
        readonly status: string;
      }>`
        SELECT
          request_id AS "requestId",
          status
        FROM projection_pending_approvals
        ORDER BY request_id ASC
      `;
      assert.deepStrictEqual(approvalRows, [
        {
          requestId: "approval-valid",
          status: "pending",
        },
      ]);

      const sessionCounts = yield* sql<{
        readonly sessionId: string;
        readonly pendingApprovalCount: number;
      }>`
        SELECT
          session_id AS "sessionId",
          pending_approval_count AS "pendingApprovalCount"
        FROM projection_sessions
        ORDER BY session_id ASC
      `;
      assert.deepStrictEqual(sessionCounts, [
        {
          sessionId: "session-invalid",
          pendingApprovalCount: 0,
        },
        {
          sessionId: "session-valid",
          pendingApprovalCount: 1,
        },
      ]);
    }),
  );
});
