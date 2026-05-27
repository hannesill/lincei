import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Struct from "effect/Struct";

import { toPersistenceSqlError } from "../Errors.ts";
import {
  DeleteProjectionSessionInput,
  GetProjectionSessionInput,
  ListProjectionSessionsByProjectInput,
  ProjectionSession,
  ProjectionSessionRepository,
  type ProjectionSessionRepositoryShape,
} from "../Services/ProjectionSessions.ts";
import { ModelSelection } from "@t3tools/contracts";

const ProjectionSessionDbRow = ProjectionSession.mapFields(
  Struct.assign({
    modelSelection: Schema.fromJsonString(ModelSelection),
  }),
);
type ProjectionSessionDbRow = typeof ProjectionSessionDbRow.Type;

const makeProjectionSessionRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertProjectionSessionRow = SqlSchema.void({
    Request: ProjectionSession,
    execute: (row) =>
      sql`
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
        VALUES (
          ${row.sessionId},
          ${row.projectId},
          ${row.title},
          ${JSON.stringify(row.modelSelection)},
          ${row.runtimeMode},
          ${row.interactionMode},
          ${row.branch},
          ${row.worktreePath},
          ${row.latestTurnId},
          ${row.createdAt},
          ${row.updatedAt},
          ${row.archivedAt},
          ${row.latestUserMessageAt},
          ${row.pendingApprovalCount},
          ${row.pendingUserInputCount},
          ${row.hasActionableProposedPlan},
          ${row.deletedAt}
        )
        ON CONFLICT (session_id)
        DO UPDATE SET
          project_id = excluded.project_id,
          title = excluded.title,
          model_selection_json = excluded.model_selection_json,
          runtime_mode = excluded.runtime_mode,
          interaction_mode = excluded.interaction_mode,
          branch = excluded.branch,
          worktree_path = excluded.worktree_path,
          latest_turn_id = excluded.latest_turn_id,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at,
          archived_at = excluded.archived_at,
          latest_user_message_at = excluded.latest_user_message_at,
          pending_approval_count = excluded.pending_approval_count,
          pending_user_input_count = excluded.pending_user_input_count,
          has_actionable_proposed_plan = excluded.has_actionable_proposed_plan,
          deleted_at = excluded.deleted_at
      `,
  });

  const getProjectionSessionRow = SqlSchema.findOneOption({
    Request: GetProjectionSessionInput,
    Result: ProjectionSessionDbRow,
    execute: ({ sessionId }) =>
      sql`
        SELECT
          session_id AS "sessionId",
          project_id AS "projectId",
          title,
          model_selection_json AS "modelSelection",
          runtime_mode AS "runtimeMode",
          interaction_mode AS "interactionMode",
          branch,
          worktree_path AS "worktreePath",
          latest_turn_id AS "latestTurnId",
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          archived_at AS "archivedAt",
          latest_user_message_at AS "latestUserMessageAt",
          pending_approval_count AS "pendingApprovalCount",
          pending_user_input_count AS "pendingUserInputCount",
          has_actionable_proposed_plan AS "hasActionableProposedPlan",
          deleted_at AS "deletedAt"
        FROM projection_sessions
        WHERE session_id = ${sessionId}
      `,
  });

  const listProjectionSessionRows = SqlSchema.findAll({
    Request: ListProjectionSessionsByProjectInput,
    Result: ProjectionSessionDbRow,
    execute: ({ projectId }) =>
      sql`
        SELECT
          session_id AS "sessionId",
          project_id AS "projectId",
          title,
          model_selection_json AS "modelSelection",
          runtime_mode AS "runtimeMode",
          interaction_mode AS "interactionMode",
          branch,
          worktree_path AS "worktreePath",
          latest_turn_id AS "latestTurnId",
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          archived_at AS "archivedAt",
          latest_user_message_at AS "latestUserMessageAt",
          pending_approval_count AS "pendingApprovalCount",
          pending_user_input_count AS "pendingUserInputCount",
          has_actionable_proposed_plan AS "hasActionableProposedPlan",
          deleted_at AS "deletedAt"
        FROM projection_sessions
        WHERE project_id = ${projectId}
        ORDER BY created_at ASC, session_id ASC
      `,
  });

  const deleteProjectionSessionRow = SqlSchema.void({
    Request: DeleteProjectionSessionInput,
    execute: ({ sessionId }) =>
      sql`
        DELETE FROM projection_sessions
        WHERE session_id = ${sessionId}
      `,
  });

  const upsert: ProjectionSessionRepositoryShape["upsert"] = (row) =>
    upsertProjectionSessionRow(row).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionSessionRepository.upsert:query")),
    );

  const getById: ProjectionSessionRepositoryShape["getById"] = (input) =>
    getProjectionSessionRow(input).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionSessionRepository.getById:query")),
    );

  const listByProjectId: ProjectionSessionRepositoryShape["listByProjectId"] = (input) =>
    listProjectionSessionRows(input).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionSessionRepository.listByProjectId:query")),
    );

  const deleteById: ProjectionSessionRepositoryShape["deleteById"] = (input) =>
    deleteProjectionSessionRow(input).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionSessionRepository.deleteById:query")),
    );

  return {
    upsert,
    getById,
    listByProjectId,
    deleteById,
  } satisfies ProjectionSessionRepositoryShape;
});

export const ProjectionSessionRepositoryLive = Layer.effect(
  ProjectionSessionRepository,
  makeProjectionSessionRepository,
);
