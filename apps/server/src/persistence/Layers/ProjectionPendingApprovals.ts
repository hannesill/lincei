import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { toPersistenceSqlError } from "../Errors.ts";
import {
  GetProjectionPendingApprovalInput,
  DeleteProjectionPendingApprovalInput,
  DeleteProjectionPendingApprovalsInput,
  ListProjectionPendingApprovalsInput,
  ProjectionPendingApproval,
  ProjectionPendingApprovalRepository,
  type ProjectionPendingApprovalRepositoryShape,
} from "../Services/ProjectionPendingApprovals.ts";

const makeProjectionPendingApprovalRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertProjectionPendingApprovalRow = SqlSchema.void({
    Request: ProjectionPendingApproval,
    execute: (row) =>
      sql`
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
          ${row.requestId},
          ${row.sessionId},
          ${row.turnId},
          ${row.status},
          ${row.decision},
          ${row.createdAt},
          ${row.resolvedAt}
        )
        ON CONFLICT (request_id)
        DO UPDATE SET
          session_id = excluded.session_id,
          turn_id = excluded.turn_id,
          status = excluded.status,
          decision = excluded.decision,
          created_at = excluded.created_at,
          resolved_at = excluded.resolved_at
      `,
  });

  const listProjectionPendingApprovalRows = SqlSchema.findAll({
    Request: ListProjectionPendingApprovalsInput,
    Result: ProjectionPendingApproval,
    execute: ({ sessionId }) =>
      sql`
        SELECT
          request_id AS "requestId",
          session_id AS "sessionId",
          turn_id AS "turnId",
          status,
          decision,
          created_at AS "createdAt",
          resolved_at AS "resolvedAt"
        FROM projection_pending_approvals
        WHERE session_id = ${sessionId}
        ORDER BY created_at ASC, request_id ASC
      `,
  });

  const getProjectionPendingApprovalRow = SqlSchema.findOneOption({
    Request: GetProjectionPendingApprovalInput,
    Result: ProjectionPendingApproval,
    execute: ({ requestId }) =>
      sql`
        SELECT
          request_id AS "requestId",
          session_id AS "sessionId",
          turn_id AS "turnId",
          status,
          decision,
          created_at AS "createdAt",
          resolved_at AS "resolvedAt"
        FROM projection_pending_approvals
        WHERE request_id = ${requestId}
      `,
  });

  const deleteProjectionPendingApprovalRow = SqlSchema.void({
    Request: DeleteProjectionPendingApprovalInput,
    execute: ({ requestId }) =>
      sql`
        DELETE FROM projection_pending_approvals
        WHERE request_id = ${requestId}
      `,
  });

  const deleteProjectionPendingApprovalRows = SqlSchema.void({
    Request: DeleteProjectionPendingApprovalsInput,
    execute: ({ sessionId }) =>
      sql`
        DELETE FROM projection_pending_approvals
        WHERE session_id = ${sessionId}
      `,
  });

  const upsert: ProjectionPendingApprovalRepositoryShape["upsert"] = (row) =>
    upsertProjectionPendingApprovalRow(row).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionPendingApprovalRepository.upsert:query")),
    );

  const listBySessionId: ProjectionPendingApprovalRepositoryShape["listBySessionId"] = (input) =>
    listProjectionPendingApprovalRows(input).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionPendingApprovalRepository.listBySessionId:query"),
      ),
    );

  const getByRequestId: ProjectionPendingApprovalRepositoryShape["getByRequestId"] = (input) =>
    getProjectionPendingApprovalRow(input).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionPendingApprovalRepository.getByRequestId:query"),
      ),
    );

  const deleteByRequestId: ProjectionPendingApprovalRepositoryShape["deleteByRequestId"] = (
    input,
  ) =>
    deleteProjectionPendingApprovalRow(input).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionPendingApprovalRepository.deleteByRequestId:query"),
      ),
    );

  const deleteBySessionId: ProjectionPendingApprovalRepositoryShape["deleteBySessionId"] = (
    input,
  ) =>
    deleteProjectionPendingApprovalRows(input).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionPendingApprovalRepository.deleteBySessionId:query"),
      ),
    );

  return {
    upsert,
    listBySessionId,
    getByRequestId,
    deleteByRequestId,
    deleteBySessionId,
  } satisfies ProjectionPendingApprovalRepositoryShape;
});

export const ProjectionPendingApprovalRepositoryLive = Layer.effect(
  ProjectionPendingApprovalRepository,
  makeProjectionPendingApprovalRepository,
);
