import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import { toPersistenceSqlError } from "../Errors.ts";
import {
  DeleteProjectionSessionProposedPlansInput,
  ListProjectionSessionProposedPlansInput,
  ProjectionSessionProposedPlan,
  ProjectionSessionProposedPlanRepository,
  type ProjectionSessionProposedPlanRepositoryShape,
} from "../Services/ProjectionSessionProposedPlans.ts";

const makeProjectionSessionProposedPlanRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertProjectionSessionProposedPlanRow = SqlSchema.void({
    Request: ProjectionSessionProposedPlan,
    execute: (row) => sql`
      INSERT INTO projection_session_proposed_plans (
        plan_id,
        session_id,
        turn_id,
        plan_markdown,
        implemented_at,
        implementation_session_id,
        created_at,
        updated_at
      )
      VALUES (
        ${row.planId},
        ${row.sessionId},
        ${row.turnId},
        ${row.planMarkdown},
        ${row.implementedAt},
        ${row.implementationSessionId},
        ${row.createdAt},
        ${row.updatedAt}
      )
      ON CONFLICT (plan_id)
      DO UPDATE SET
        session_id = excluded.session_id,
        turn_id = excluded.turn_id,
        plan_markdown = excluded.plan_markdown,
        implemented_at = excluded.implemented_at,
        implementation_session_id = excluded.implementation_session_id,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at
    `,
  });

  const listProjectionSessionProposedPlanRows = SqlSchema.findAll({
    Request: ListProjectionSessionProposedPlansInput,
    Result: ProjectionSessionProposedPlan,
    execute: ({ sessionId }) => sql`
      SELECT
        plan_id AS "planId",
        session_id AS "sessionId",
        turn_id AS "turnId",
        plan_markdown AS "planMarkdown",
        implemented_at AS "implementedAt",
        implementation_session_id AS "implementationSessionId",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM projection_session_proposed_plans
      WHERE session_id = ${sessionId}
      ORDER BY created_at ASC, plan_id ASC
    `,
  });

  const deleteProjectionSessionProposedPlanRows = SqlSchema.void({
    Request: DeleteProjectionSessionProposedPlansInput,
    execute: ({ sessionId }) => sql`
      DELETE FROM projection_session_proposed_plans
      WHERE session_id = ${sessionId}
    `,
  });

  const upsert: ProjectionSessionProposedPlanRepositoryShape["upsert"] = (row) =>
    upsertProjectionSessionProposedPlanRow(row).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionSessionProposedPlanRepository.upsert:query"),
      ),
    );

  const listBySessionId: ProjectionSessionProposedPlanRepositoryShape["listBySessionId"] = (
    input,
  ) =>
    listProjectionSessionProposedPlanRows(input).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionSessionProposedPlanRepository.listBySessionId:query"),
      ),
    );

  const deleteBySessionId: ProjectionSessionProposedPlanRepositoryShape["deleteBySessionId"] = (
    input,
  ) =>
    deleteProjectionSessionProposedPlanRows(input).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionSessionProposedPlanRepository.deleteBySessionId:query"),
      ),
    );

  return {
    upsert,
    listBySessionId,
    deleteBySessionId,
  } satisfies ProjectionSessionProposedPlanRepositoryShape;
});

export const ProjectionSessionProposedPlanRepositoryLive = Layer.effect(
  ProjectionSessionProposedPlanRepository,
  makeProjectionSessionProposedPlanRepository,
);
