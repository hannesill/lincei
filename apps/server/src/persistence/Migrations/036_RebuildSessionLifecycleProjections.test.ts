import {
  ApprovalRequestId,
  CommandId,
  CorrelationId,
  EventId,
  ProjectId,
  ProviderInstanceId,
  SessionId,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { ServerConfig } from "../../config.ts";
import { OrchestrationEventStoreLive } from "../Layers/OrchestrationEventStore.ts";
import { SqlitePersistenceMemory } from "../Layers/Sqlite.ts";
import { OrchestrationEventStore } from "../Services/OrchestrationEventStore.ts";
import { OrchestrationProjectionPipelineLive } from "../../orchestration/Layers/ProjectionPipeline.ts";
import { OrchestrationProjectionPipeline } from "../../orchestration/Services/ProjectionPipeline.ts";
import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";
import Migration036 from "./036_RebuildSessionLifecycleProjections.ts";

it.layer(NodeSqliteClient.layerMemory())("036_RebuildSessionLifecycleProjections", (it) => {
  it.effect("clears affected derived rows and rewinds only lifecycle projectors", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 35 });

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
        VALUES (
          'activity-legacy-order',
          'session-lifecycle-rebuild',
          NULL,
          'approval',
          'approval.requested',
          'Approval requested',
          '{"requestId":"request-lifecycle-rebuild"}',
          9001,
          '2026-07-01T12:00:00.000Z'
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
        VALUES (
          'request-lifecycle-rebuild',
          'session-lifecycle-rebuild',
          NULL,
          'resolved',
          'accept',
          '2026-07-01T12:00:00.000Z',
          '2026-07-01T12:00:01.000Z'
        )
      `;
      yield* sql`
        INSERT INTO projection_state (projector, last_applied_sequence, updated_at)
        VALUES
          ('projection.projects', 42, '2026-07-01T12:00:02.000Z'),
          ('projection.session-activities', 42, '2026-07-01T12:00:02.000Z'),
          ('projection.pending-approvals', 42, '2026-07-01T12:00:02.000Z'),
          ('projection.sessions', 42, '2026-07-01T12:00:02.000Z')
      `;

      yield* Migration036;
      yield* Migration036;

      const activityCount = yield* sql<{ readonly count: number }>`
        SELECT COUNT(*) AS count FROM projection_session_activities
      `;
      const pendingApprovalCount = yield* sql<{ readonly count: number }>`
        SELECT COUNT(*) AS count FROM projection_pending_approvals
      `;
      const projectorRows = yield* sql<{ readonly projector: string }>`
        SELECT projector
        FROM projection_state
        ORDER BY projector
      `;
      const sessionColumns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(projection_sessions)
      `;
      const activityColumns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(projection_session_activities)
      `;

      assert.deepStrictEqual(activityCount, [{ count: 0 }]);
      assert.deepStrictEqual(pendingApprovalCount, [{ count: 0 }]);
      assert.deepStrictEqual(projectorRows, [
        { projector: "projection.projects" },
        { projector: "projection.sessions" },
      ]);
      assert.equal(
        sessionColumns.filter((column) => column.name === "pending_request_raised_at").length,
        1,
      );
      assert.equal(
        activityColumns.filter((column) => column.name === "event_occurred_at").length,
        1,
      );
    }),
  );
});

const RebuildProjectionTestLayer = OrchestrationProjectionPipelineLive.pipe(
  Layer.provideMerge(OrchestrationEventStoreLive),
  Layer.provideMerge(
    ServerConfig.layerTest(process.cwd(), {
      prefix: "t3-rebuild-session-lifecycle-projections-test-",
    }),
  ),
  Layer.provideMerge(SqlitePersistenceMemory),
  Layer.provideMerge(NodeServices.layer),
);

it.layer(RebuildProjectionTestLayer)(
  "036_RebuildSessionLifecycleProjections ordered replay",
  (it) => {
    it.effect("reopens response-dispatched approvals until provider confirmation", () =>
      Effect.gen(function* () {
        const eventStore = yield* OrchestrationEventStore;
        const projectionPipeline = yield* OrchestrationProjectionPipeline;
        const sql = yield* SqlClient.SqlClient;
        const appendAndProject = (event: Parameters<typeof eventStore.append>[0]) =>
          Effect.gen(function* () {
            const savedEvent = yield* eventStore.append(event);
            yield* projectionPipeline.projectEvent(savedEvent);
            return savedEvent;
          });

        yield* appendAndProject({
          type: "session.created",
          eventId: EventId.make("event-lifecycle-rebuild-created"),
          aggregateKind: "session",
          aggregateId: SessionId.make("session-lifecycle-rebuild"),
          occurredAt: "2026-07-01T12:00:00.000Z",
          commandId: CommandId.make("command-lifecycle-rebuild-created"),
          causationEventId: null,
          correlationId: CorrelationId.make("command-lifecycle-rebuild-created"),
          metadata: {},
          payload: {
            sessionId: SessionId.make("session-lifecycle-rebuild"),
            projectId: ProjectId.make("project-lifecycle-rebuild"),
            title: "Lifecycle rebuild",
            modelSelection: {
              instanceId: ProviderInstanceId.make("codex"),
              model: "gpt-5.4",
            },
            runtimeMode: "approval-required",
            interactionMode: "default",
            branch: null,
            worktreePath: null,
            createdAt: "2026-07-01T12:00:00.000Z",
            updatedAt: "2026-07-01T12:00:00.000Z",
          },
        });
        const requestedEvent = yield* appendAndProject({
          type: "session.activity-appended",
          eventId: EventId.make("event-lifecycle-rebuild-requested"),
          aggregateKind: "session",
          aggregateId: SessionId.make("session-lifecycle-rebuild"),
          occurredAt: "2026-07-01T12:00:01.000Z",
          commandId: CommandId.make("command-lifecycle-rebuild-requested"),
          causationEventId: null,
          correlationId: CorrelationId.make("command-lifecycle-rebuild-requested"),
          metadata: {},
          payload: {
            sessionId: SessionId.make("session-lifecycle-rebuild"),
            activity: {
              id: EventId.make("activity-lifecycle-rebuild-requested"),
              tone: "approval",
              kind: "approval.requested",
              summary: "Approval requested",
              payload: { requestId: "request-lifecycle-rebuild" },
              turnId: null,
              createdAt: "2026-07-01T12:00:01.000Z",
            },
          },
        });
        yield* appendAndProject({
          type: "session.approval-response-requested",
          eventId: EventId.make("event-lifecycle-rebuild-response"),
          aggregateKind: "session",
          aggregateId: SessionId.make("session-lifecycle-rebuild"),
          occurredAt: "2026-07-01T12:00:02.000Z",
          commandId: CommandId.make("command-lifecycle-rebuild-response"),
          causationEventId: null,
          correlationId: CorrelationId.make("command-lifecycle-rebuild-response"),
          metadata: {},
          payload: {
            sessionId: SessionId.make("session-lifecycle-rebuild"),
            requestId: ApprovalRequestId.make("request-lifecycle-rebuild"),
            decision: "accept",
            createdAt: "2026-07-01T12:00:02.000Z",
          },
        });
        yield* appendAndProject({
          type: "session.activity-appended",
          eventId: EventId.make("event-lifecycle-rebuild-newer-requested"),
          aggregateKind: "session",
          aggregateId: SessionId.make("session-lifecycle-rebuild"),
          occurredAt: "2026-07-01T12:00:03.000Z",
          commandId: CommandId.make("command-lifecycle-rebuild-newer-requested"),
          causationEventId: null,
          correlationId: CorrelationId.make("command-lifecycle-rebuild-newer-requested"),
          metadata: {},
          payload: {
            sessionId: SessionId.make("session-lifecycle-rebuild"),
            activity: {
              id: EventId.make("activity-lifecycle-rebuild-newer-requested"),
              tone: "approval",
              kind: "approval.requested",
              summary: "Newer approval requested",
              payload: { requestId: "request-lifecycle-rebuild-newer" },
              turnId: null,
              // Provider time is deliberately unrelated. Wake ordering is
              // anchored to the durable orchestration event timestamp.
              createdAt: "2030-07-01T12:00:03.000Z",
            },
          },
        });
        yield* appendAndProject({
          type: "session.activity-appended",
          eventId: EventId.make("event-lifecycle-rebuild-newer-resolved"),
          aggregateKind: "session",
          aggregateId: SessionId.make("session-lifecycle-rebuild"),
          occurredAt: "2026-07-01T12:00:04.000Z",
          commandId: CommandId.make("command-lifecycle-rebuild-newer-resolved"),
          causationEventId: null,
          correlationId: CorrelationId.make("command-lifecycle-rebuild-newer-resolved"),
          metadata: {},
          payload: {
            sessionId: SessionId.make("session-lifecycle-rebuild"),
            activity: {
              id: EventId.make("activity-lifecycle-rebuild-newer-resolved"),
              tone: "info",
              kind: "approval.resolved",
              summary: "Newer approval resolved",
              payload: {
                requestId: "request-lifecycle-rebuild-newer",
                decision: "accept",
              },
              turnId: null,
              createdAt: "2030-07-01T12:00:04.000Z",
            },
          },
        });

        // Reproduce migration-024-style state: response dispatch incorrectly
        // resolved the request and activity ordering used provider sequence.
        yield* sql`
          UPDATE projection_pending_approvals
          SET status = 'resolved', resolved_at = '2026-07-01T12:00:02.000Z'
          WHERE request_id = 'request-lifecycle-rebuild'
        `;
        yield* sql`
          UPDATE projection_session_activities
          SET sequence = 9001
          WHERE activity_id = 'activity-lifecycle-rebuild-requested'
        `;

        yield* Migration036;
        yield* projectionPipeline.bootstrap;

        const rebuiltApprovals = yield* sql<{
          readonly status: string;
          readonly resolvedAt: string | null;
        }>`
          SELECT status, resolved_at AS "resolvedAt"
          FROM projection_pending_approvals
          WHERE request_id = 'request-lifecycle-rebuild'
        `;
        const rebuiltActivities = yield* sql<{
          readonly sequence: number;
          readonly eventOccurredAt: string | null;
        }>`
          SELECT
            sequence,
            event_occurred_at AS "eventOccurredAt"
          FROM projection_session_activities
          WHERE activity_id = 'activity-lifecycle-rebuild-requested'
        `;
        const rebuiltSessions = yield* sql<{
          readonly pendingApprovalCount: number;
          readonly pendingRequestRaisedAt: string | null;
        }>`
          SELECT
            pending_approval_count AS "pendingApprovalCount",
            pending_request_raised_at AS "pendingRequestRaisedAt"
          FROM projection_sessions
          WHERE session_id = 'session-lifecycle-rebuild'
        `;
        const lifecycleState = yield* sql<{
          readonly projector: string;
          readonly lastAppliedSequence: number;
        }>`
          SELECT
            projector,
            last_applied_sequence AS "lastAppliedSequence"
          FROM projection_state
          WHERE projector IN (
            'projection.sessions',
            'projection.session-lifecycle-summary-v36'
          )
          ORDER BY projector
        `;
        assert.deepStrictEqual(rebuiltApprovals, [{ status: "pending", resolvedAt: null }]);
        assert.deepStrictEqual(rebuiltActivities, [
          {
            sequence: requestedEvent.sequence,
            eventOccurredAt: "2026-07-01T12:00:01.000Z",
          },
        ]);
        assert.deepStrictEqual(rebuiltSessions, [
          {
            pendingApprovalCount: 1,
            pendingRequestRaisedAt: "2026-07-01T12:00:01.000Z",
          },
        ]);
        assert.deepStrictEqual(lifecycleState, [
          {
            projector: "projection.session-lifecycle-summary-v36",
            lastAppliedSequence: 5,
          },
          {
            projector: "projection.sessions",
            lastAppliedSequence: 5,
          },
        ]);

        yield* appendAndProject({
          type: "session.activity-appended",
          eventId: EventId.make("event-lifecycle-rebuild-resolved"),
          aggregateKind: "session",
          aggregateId: SessionId.make("session-lifecycle-rebuild"),
          occurredAt: "2026-07-01T12:00:05.000Z",
          commandId: CommandId.make("command-lifecycle-rebuild-resolved"),
          causationEventId: null,
          correlationId: CorrelationId.make("command-lifecycle-rebuild-resolved"),
          metadata: {},
          payload: {
            sessionId: SessionId.make("session-lifecycle-rebuild"),
            activity: {
              id: EventId.make("activity-lifecycle-rebuild-resolved"),
              tone: "info",
              kind: "approval.resolved",
              summary: "Approval resolved",
              payload: {
                requestId: "request-lifecycle-rebuild",
                decision: "accept",
              },
              turnId: null,
              createdAt: "2026-07-01T12:00:05.000Z",
            },
          },
        });

        const confirmedApprovals = yield* sql<{
          readonly status: string;
          readonly resolvedAt: string | null;
        }>`
          SELECT status, resolved_at AS "resolvedAt"
          FROM projection_pending_approvals
          WHERE request_id = 'request-lifecycle-rebuild'
        `;
        const confirmedSessions = yield* sql<{
          readonly pendingApprovalCount: number;
          readonly pendingRequestRaisedAt: string | null;
        }>`
          SELECT
            pending_approval_count AS "pendingApprovalCount",
            pending_request_raised_at AS "pendingRequestRaisedAt"
          FROM projection_sessions
          WHERE session_id = 'session-lifecycle-rebuild'
        `;
        assert.deepStrictEqual(confirmedApprovals, [
          { status: "resolved", resolvedAt: "2026-07-01T12:00:05.000Z" },
        ]);
        assert.deepStrictEqual(confirmedSessions, [
          { pendingApprovalCount: 0, pendingRequestRaisedAt: null },
        ]);
      }),
    );
  },
);
