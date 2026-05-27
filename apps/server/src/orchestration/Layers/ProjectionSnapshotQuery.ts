import {
  ChatAttachment,
  CheckpointRef,
  IsoDateTime,
  MessageId,
  NonNegativeInt,
  OrchestrationCheckpointFile,
  OrchestrationProposedPlanId,
  OrchestrationReadModel,
  OrchestrationShellSnapshot,
  OrchestrationSession,
  ProjectScript,
  TurnId,
  type OrchestrationCheckpointSummary,
  type OrchestrationLatestTurn,
  type OrchestrationMessage,
  type OrchestrationProjectShell,
  type OrchestrationProposedPlan,
  type OrchestrationProject,
  type OrchestrationProviderRuntime,
  type OrchestrationSessionActivity,
  type OrchestrationSessionShell,
  ModelSelection,
  ProjectId,
  SessionId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Struct from "effect/Struct";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import {
  isPersistenceError,
  toPersistenceDecodeError,
  toPersistenceSqlError,
  type ProjectionRepositoryError,
} from "../../persistence/Errors.ts";
import { ProjectionCheckpoint } from "../../persistence/Services/ProjectionCheckpoints.ts";
import { ProjectionProject } from "../../persistence/Services/ProjectionProjects.ts";
import { ProjectionState } from "../../persistence/Services/ProjectionState.ts";
import { ProjectionSessionActivity } from "../../persistence/Services/ProjectionSessionActivities.ts";
import { ProjectionSessionMessage } from "../../persistence/Services/ProjectionSessionMessages.ts";
import { ProjectionSessionProposedPlan } from "../../persistence/Services/ProjectionSessionProposedPlans.ts";
import { ProjectionProviderRuntime } from "../../persistence/Services/ProjectionProviderRuntimes.ts";
import { ProjectionSession } from "../../persistence/Services/ProjectionSessions.ts";
import { RepositoryIdentityResolver } from "../../project/Services/RepositoryIdentityResolver.ts";
import { ORCHESTRATION_PROJECTOR_NAMES } from "./ProjectionPipeline.ts";
import {
  ProjectionSnapshotQuery,
  type ProjectionFullSessionDiffContext,
  type ProjectionSnapshotCounts,
  type ProjectionSessionCheckpointContext,
  type ProjectionSnapshotQueryShape,
} from "../Services/ProjectionSnapshotQuery.ts";

const decodeReadModel = Schema.decodeUnknownEffect(OrchestrationReadModel);
const decodeShellSnapshot = Schema.decodeUnknownEffect(OrchestrationShellSnapshot);
const decodeSession = Schema.decodeUnknownEffect(OrchestrationSession);
const ProjectionProjectDbRowSchema = ProjectionProject.mapFields(
  Struct.assign({
    defaultModelSelection: Schema.NullOr(Schema.fromJsonString(ModelSelection)),
    scripts: Schema.fromJsonString(Schema.Array(ProjectScript)),
  }),
);
const ProjectionSessionMessageDbRowSchema = ProjectionSessionMessage.mapFields(
  Struct.assign({
    isStreaming: Schema.Number,
    attachments: Schema.NullOr(Schema.fromJsonString(Schema.Array(ChatAttachment))),
  }),
);
const ProjectionSessionProposedPlanDbRowSchema = ProjectionSessionProposedPlan;
const ProjectionSessionDbRowSchema = ProjectionSession.mapFields(
  Struct.assign({
    modelSelection: Schema.fromJsonString(ModelSelection),
  }),
);
const ProjectionSessionActivityDbRowSchema = ProjectionSessionActivity.mapFields(
  Struct.assign({
    payload: Schema.fromJsonString(Schema.Unknown),
    sequence: Schema.NullOr(NonNegativeInt),
  }),
);
const ProjectionProviderRuntimeDbRowSchema = ProjectionProviderRuntime;
const ProjectionCheckpointDbRowSchema = ProjectionCheckpoint.mapFields(
  Struct.assign({
    files: Schema.fromJsonString(Schema.Array(OrchestrationCheckpointFile)),
  }),
);
const ProjectionLatestTurnDbRowSchema = Schema.Struct({
  sessionId: ProjectionSession.fields.sessionId,
  turnId: TurnId,
  state: Schema.String,
  requestedAt: IsoDateTime,
  startedAt: Schema.NullOr(IsoDateTime),
  completedAt: Schema.NullOr(IsoDateTime),
  assistantMessageId: Schema.NullOr(MessageId),
  sourceProposedPlanSessionId: Schema.NullOr(SessionId),
  sourceProposedPlanId: Schema.NullOr(OrchestrationProposedPlanId),
});
const ProjectionStateDbRowSchema = ProjectionState;
const ProjectionCountsRowSchema = Schema.Struct({
  projectCount: Schema.Number,
  sessionCount: Schema.Number,
});
const WorkspaceRootLookupInput = Schema.Struct({
  workspaceRoot: Schema.String,
});
const ProjectIdLookupInput = Schema.Struct({
  projectId: ProjectId,
});
const SessionIdLookupInput = Schema.Struct({
  sessionId: SessionId,
});
const ProjectionProjectLookupRowSchema = ProjectionProjectDbRowSchema;
const ProjectionSessionIdLookupRowSchema = Schema.Struct({
  sessionId: SessionId,
});
const ProjectionSessionCheckpointContextSessionRowSchema = Schema.Struct({
  sessionId: SessionId,
  projectId: ProjectId,
  workspaceRoot: Schema.String,
  worktreePath: Schema.NullOr(Schema.String),
});
const FullSessionDiffContextLookupInput = Schema.Struct({
  sessionId: SessionId,
  checkpointTurnCount: NonNegativeInt,
});
const ProjectionFullSessionDiffContextRowSchema = Schema.Struct({
  sessionId: SessionId,
  projectId: ProjectId,
  workspaceRoot: Schema.String,
  worktreePath: Schema.NullOr(Schema.String),
  latestCheckpointTurnCount: Schema.NullOr(NonNegativeInt),
  toCheckpointRef: Schema.NullOr(CheckpointRef),
});

const REQUIRED_SNAPSHOT_PROJECTORS = [
  ORCHESTRATION_PROJECTOR_NAMES.projects,
  ORCHESTRATION_PROJECTOR_NAMES.sessions,
  ORCHESTRATION_PROJECTOR_NAMES.sessionMessages,
  ORCHESTRATION_PROJECTOR_NAMES.sessionProposedPlans,
  ORCHESTRATION_PROJECTOR_NAMES.sessionActivities,
  ORCHESTRATION_PROJECTOR_NAMES.providerRuntimes,
  ORCHESTRATION_PROJECTOR_NAMES.checkpoints,
] as const;

function maxIso(left: string | null, right: string): string {
  if (left === null) {
    return right;
  }
  return left > right ? left : right;
}

function computeSnapshotSequence(
  stateRows: ReadonlyArray<Schema.Schema.Type<typeof ProjectionStateDbRowSchema>>,
): number {
  if (stateRows.length === 0) {
    return 0;
  }
  const sequenceByProjector = new Map(
    stateRows.map((row) => [row.projector, row.lastAppliedSequence] as const),
  );

  let minSequence = Number.POSITIVE_INFINITY;
  for (const projector of REQUIRED_SNAPSHOT_PROJECTORS) {
    const sequence = sequenceByProjector.get(projector);
    if (sequence === undefined) {
      return 0;
    }
    if (sequence < minSequence) {
      minSequence = sequence;
    }
  }

  return Number.isFinite(minSequence) ? minSequence : 0;
}

function mapLatestTurn(
  row: Schema.Schema.Type<typeof ProjectionLatestTurnDbRowSchema>,
): OrchestrationLatestTurn {
  return {
    turnId: row.turnId,
    state:
      row.state === "error"
        ? "error"
        : row.state === "interrupted"
          ? "interrupted"
          : row.state === "completed"
            ? "completed"
            : "running",
    requestedAt: row.requestedAt,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    assistantMessageId: row.assistantMessageId,
    ...(row.sourceProposedPlanSessionId !== null && row.sourceProposedPlanId !== null
      ? {
          sourceProposedPlan: {
            sessionId: row.sourceProposedPlanSessionId,
            planId: row.sourceProposedPlanId,
          },
        }
      : {}),
  };
}

function mapSessionRow(
  row: Schema.Schema.Type<typeof ProjectionProviderRuntimeDbRowSchema>,
): OrchestrationProviderRuntime {
  return {
    sessionId: row.sessionId,
    status: row.status,
    providerName: row.providerName,
    ...(row.providerInstanceId !== null ? { providerInstanceId: row.providerInstanceId } : {}),
    runtimeMode: row.runtimeMode,
    activeTurnId: row.activeTurnId,
    lastError: row.lastError,
    updatedAt: row.updatedAt,
  };
}

function mapProjectShellRow(
  row: Schema.Schema.Type<typeof ProjectionProjectDbRowSchema>,
  repositoryIdentity: OrchestrationProject["repositoryIdentity"],
): OrchestrationProjectShell {
  return {
    id: row.projectId,
    title: row.title,
    workspaceRoot: row.workspaceRoot,
    repositoryIdentity,
    defaultModelSelection: row.defaultModelSelection,
    scripts: row.scripts,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapProposedPlanRow(
  row: Schema.Schema.Type<typeof ProjectionSessionProposedPlanDbRowSchema>,
): OrchestrationProposedPlan {
  return {
    id: row.planId,
    turnId: row.turnId,
    planMarkdown: row.planMarkdown,
    implementedAt: row.implementedAt,
    implementationSessionId: row.implementationSessionId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toPersistenceSqlOrDecodeError(sqlOperation: string, decodeOperation: string) {
  return (cause: unknown): ProjectionRepositoryError =>
    Schema.isSchemaError(cause)
      ? toPersistenceDecodeError(decodeOperation)(cause)
      : toPersistenceSqlError(sqlOperation)(cause);
}

const makeProjectionSnapshotQuery = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const repositoryIdentityResolver = yield* RepositoryIdentityResolver;
  const repositoryIdentityResolutionConcurrency = 4;
  const resolveRepositoryIdentitiesForProjects = Effect.fn(
    "ProjectionSnapshotQuery.resolveRepositoryIdentitiesForProjects",
  )(function* (
    projectRows: ReadonlyArray<Schema.Schema.Type<typeof ProjectionProjectDbRowSchema>>,
    options?: {
      readonly includeDeleted?: boolean;
    },
  ) {
    const filteredProjectRows =
      options?.includeDeleted === true
        ? projectRows
        : projectRows.filter((row) => row.deletedAt === null);
    const uniqueWorkspaceRoots = [...new Set(filteredProjectRows.map((row) => row.workspaceRoot))];
    const repositoryIdentityByWorkspaceRoot = new Map(
      yield* Effect.forEach(
        uniqueWorkspaceRoots,
        (workspaceRoot) =>
          repositoryIdentityResolver
            .resolve(workspaceRoot)
            .pipe(Effect.map((identity) => [workspaceRoot, identity] as const)),
        { concurrency: repositoryIdentityResolutionConcurrency },
      ),
    );

    return new Map(
      filteredProjectRows.map((row) => [
        row.projectId,
        repositoryIdentityByWorkspaceRoot.get(row.workspaceRoot) ?? null,
      ]),
    );
  });

  const listProjectRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionProjectDbRowSchema,
    execute: () =>
      sql`
        SELECT
          project_id AS "projectId",
          title,
          workspace_root AS "workspaceRoot",
          default_model_selection_json AS "defaultModelSelection",
          scripts_json AS "scripts",
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          deleted_at AS "deletedAt"
        FROM projection_projects
        ORDER BY created_at ASC, project_id ASC
      `,
  });

  const listSessionRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionSessionDbRowSchema,
    execute: () =>
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
        ORDER BY created_at ASC, session_id ASC
      `,
  });

  const listActiveSessionRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionSessionDbRowSchema,
    execute: () =>
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
        WHERE deleted_at IS NULL
          AND archived_at IS NULL
        ORDER BY project_id ASC, created_at ASC, session_id ASC
      `,
  });

  const listArchivedSessionRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionSessionDbRowSchema,
    execute: () =>
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
        WHERE deleted_at IS NULL
          AND archived_at IS NOT NULL
        ORDER BY project_id ASC, archived_at DESC, session_id DESC
      `,
  });

  const listSessionMessageRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionSessionMessageDbRowSchema,
    execute: () =>
      sql`
        SELECT
          message_id AS "messageId",
          session_id AS "sessionId",
          turn_id AS "turnId",
          role,
          text,
          attachments_json AS "attachments",
          is_streaming AS "isStreaming",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM projection_session_messages
        ORDER BY session_id ASC, created_at ASC, message_id ASC
      `,
  });

  const listSessionProposedPlanRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionSessionProposedPlanDbRowSchema,
    execute: () =>
      sql`
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
        ORDER BY session_id ASC, created_at ASC, plan_id ASC
      `,
  });

  const listSessionActivityRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionSessionActivityDbRowSchema,
    execute: () =>
      sql`
        SELECT
          activity_id AS "activityId",
          session_id AS "sessionId",
          turn_id AS "turnId",
          tone,
          kind,
          summary,
          payload_json AS "payload",
          sequence,
          created_at AS "createdAt"
        FROM projection_session_activities
        ORDER BY
          session_id ASC,
          sequence ASC,
          created_at ASC,
          activity_id ASC
      `,
  });

  const listProviderRuntimeRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionProviderRuntimeDbRowSchema,
    execute: () =>
      sql`
        SELECT
          session_id AS "sessionId",
          status,
          provider_name AS "providerName",
          provider_instance_id AS "providerInstanceId",
          provider_session_id AS "providerSessionId",
          runtime_mode AS "runtimeMode",
          active_turn_id AS "activeTurnId",
          last_error AS "lastError",
          updated_at AS "updatedAt"
        FROM projection_session_sessions
        ORDER BY session_id ASC
      `,
  });

  const listActiveProviderRuntimeRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionProviderRuntimeDbRowSchema,
    execute: () =>
      sql`
        SELECT
          runtimes.session_id AS "sessionId",
          runtimes.status,
          runtimes.provider_name AS "providerName",
          runtimes.provider_instance_id AS "providerInstanceId",
          runtimes.provider_session_id AS "providerSessionId",
          runtimes.runtime_mode AS "runtimeMode",
          runtimes.active_turn_id AS "activeTurnId",
          runtimes.last_error AS "lastError",
          runtimes.updated_at AS "updatedAt"
        FROM projection_session_sessions runtimes
        INNER JOIN projection_sessions sessions
          ON runtimes.session_id = sessions.session_id
        WHERE sessions.deleted_at IS NULL
          AND sessions.archived_at IS NULL
        ORDER BY runtimes.session_id ASC
      `,
  });

  const listArchivedProviderRuntimeRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionProviderRuntimeDbRowSchema,
    execute: () =>
      sql`
        SELECT
          runtimes.session_id AS "sessionId",
          runtimes.status,
          runtimes.provider_name AS "providerName",
          runtimes.provider_instance_id AS "providerInstanceId",
          runtimes.provider_session_id AS "providerSessionId",
          runtimes.runtime_mode AS "runtimeMode",
          runtimes.active_turn_id AS "activeTurnId",
          runtimes.last_error AS "lastError",
          runtimes.updated_at AS "updatedAt"
        FROM projection_session_sessions runtimes
        INNER JOIN projection_sessions sessions
          ON runtimes.session_id = sessions.session_id
        WHERE sessions.deleted_at IS NULL
          AND sessions.archived_at IS NOT NULL
        ORDER BY runtimes.session_id ASC
      `,
  });

  const listCheckpointRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionCheckpointDbRowSchema,
    execute: () =>
      sql`
        SELECT
          session_id AS "sessionId",
          turn_id AS "turnId",
          checkpoint_turn_count AS "checkpointTurnCount",
          checkpoint_ref AS "checkpointRef",
          checkpoint_status AS "status",
          checkpoint_files_json AS "files",
          assistant_message_id AS "assistantMessageId",
          completed_at AS "completedAt"
        FROM projection_turns
        WHERE checkpoint_turn_count IS NOT NULL
        ORDER BY session_id ASC, checkpoint_turn_count ASC
      `,
  });

  const listLatestTurnRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionLatestTurnDbRowSchema,
    execute: () =>
      sql`
        SELECT
          turns.session_id AS "sessionId",
          turns.turn_id AS "turnId",
          turns.state,
          turns.requested_at AS "requestedAt",
          turns.started_at AS "startedAt",
          turns.completed_at AS "completedAt",
          turns.assistant_message_id AS "assistantMessageId",
          turns.source_proposed_plan_session_id AS "sourceProposedPlanSessionId",
          turns.source_proposed_plan_id AS "sourceProposedPlanId"
        FROM projection_sessions sessions
        JOIN projection_turns turns
          ON turns.session_id = sessions.session_id
          AND turns.turn_id = sessions.latest_turn_id
        WHERE sessions.latest_turn_id IS NOT NULL
        ORDER BY turns.session_id ASC
      `,
  });

  const listActiveLatestTurnRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionLatestTurnDbRowSchema,
    execute: () =>
      sql`
        SELECT
          turns.session_id AS "sessionId",
          turns.turn_id AS "turnId",
          turns.state,
          turns.requested_at AS "requestedAt",
          turns.started_at AS "startedAt",
          turns.completed_at AS "completedAt",
          turns.assistant_message_id AS "assistantMessageId",
          turns.source_proposed_plan_session_id AS "sourceProposedPlanSessionId",
          turns.source_proposed_plan_id AS "sourceProposedPlanId"
        FROM projection_sessions sessions
        JOIN projection_turns turns
          ON turns.session_id = sessions.session_id
          AND turns.turn_id = sessions.latest_turn_id
        WHERE sessions.deleted_at IS NULL
          AND sessions.archived_at IS NULL
          AND sessions.latest_turn_id IS NOT NULL
        ORDER BY turns.session_id ASC
      `,
  });

  const listArchivedLatestTurnRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionLatestTurnDbRowSchema,
    execute: () =>
      sql`
        SELECT
          turns.session_id AS "sessionId",
          turns.turn_id AS "turnId",
          turns.state,
          turns.requested_at AS "requestedAt",
          turns.started_at AS "startedAt",
          turns.completed_at AS "completedAt",
          turns.assistant_message_id AS "assistantMessageId",
          turns.source_proposed_plan_session_id AS "sourceProposedPlanSessionId",
          turns.source_proposed_plan_id AS "sourceProposedPlanId"
        FROM projection_sessions sessions
        JOIN projection_turns turns
          ON turns.session_id = sessions.session_id
          AND turns.turn_id = sessions.latest_turn_id
        WHERE sessions.deleted_at IS NULL
          AND sessions.archived_at IS NOT NULL
          AND sessions.latest_turn_id IS NOT NULL
        ORDER BY turns.session_id ASC
      `,
  });

  const listProjectionStateRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionStateDbRowSchema,
    execute: () =>
      sql`
        SELECT
          projector,
          last_applied_sequence AS "lastAppliedSequence",
          updated_at AS "updatedAt"
        FROM projection_state
      `,
  });

  const readProjectionCounts = SqlSchema.findOne({
    Request: Schema.Void,
    Result: ProjectionCountsRowSchema,
    execute: () =>
      sql`
        SELECT
          (SELECT COUNT(*) FROM projection_projects) AS "projectCount",
          (SELECT COUNT(*) FROM projection_sessions) AS "sessionCount"
      `,
  });

  const getActiveProjectRowByWorkspaceRoot = SqlSchema.findOneOption({
    Request: WorkspaceRootLookupInput,
    Result: ProjectionProjectLookupRowSchema,
    execute: ({ workspaceRoot }) =>
      sql`
        SELECT
          project_id AS "projectId",
          title,
          workspace_root AS "workspaceRoot",
          default_model_selection_json AS "defaultModelSelection",
          scripts_json AS "scripts",
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          deleted_at AS "deletedAt"
        FROM projection_projects
        WHERE workspace_root = ${workspaceRoot}
          AND deleted_at IS NULL
        ORDER BY created_at ASC, project_id ASC
        LIMIT 1
      `,
  });

  const getActiveProjectRowById = SqlSchema.findOneOption({
    Request: ProjectIdLookupInput,
    Result: ProjectionProjectLookupRowSchema,
    execute: ({ projectId }) =>
      sql`
        SELECT
          project_id AS "projectId",
          title,
          workspace_root AS "workspaceRoot",
          default_model_selection_json AS "defaultModelSelection",
          scripts_json AS "scripts",
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          deleted_at AS "deletedAt"
        FROM projection_projects
        WHERE project_id = ${projectId}
          AND deleted_at IS NULL
        LIMIT 1
      `,
  });

  const getFirstActiveSessionIdByProject = SqlSchema.findOneOption({
    Request: ProjectIdLookupInput,
    Result: ProjectionSessionIdLookupRowSchema,
    execute: ({ projectId }) =>
      sql`
        SELECT
          session_id AS "sessionId"
        FROM projection_sessions
        WHERE project_id = ${projectId}
          AND deleted_at IS NULL
          AND archived_at IS NULL
        ORDER BY created_at ASC, session_id ASC
        LIMIT 1
      `,
  });

  const getSessionCheckpointContextSessionRow = SqlSchema.findOneOption({
    Request: SessionIdLookupInput,
    Result: ProjectionSessionCheckpointContextSessionRowSchema,
    execute: ({ sessionId }) =>
      sql`
        SELECT
          sessions.session_id AS "sessionId",
          sessions.project_id AS "projectId",
          projects.workspace_root AS "workspaceRoot",
          sessions.worktree_path AS "worktreePath"
        FROM projection_sessions AS sessions
        INNER JOIN projection_projects AS projects
          ON projects.project_id = sessions.project_id
        WHERE sessions.session_id = ${sessionId}
          AND sessions.deleted_at IS NULL
        LIMIT 1
      `,
  });

  const getActiveSessionRowById = SqlSchema.findOneOption({
    Request: SessionIdLookupInput,
    Result: ProjectionSessionDbRowSchema,
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
          AND deleted_at IS NULL
          AND archived_at IS NULL
        LIMIT 1
      `,
  });

  const listSessionMessageRowsBySession = SqlSchema.findAll({
    Request: SessionIdLookupInput,
    Result: ProjectionSessionMessageDbRowSchema,
    execute: ({ sessionId }) =>
      sql`
        SELECT
          message_id AS "messageId",
          session_id AS "sessionId",
          turn_id AS "turnId",
          role,
          text,
          attachments_json AS "attachments",
          is_streaming AS "isStreaming",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM projection_session_messages
        WHERE session_id = ${sessionId}
        ORDER BY created_at ASC, message_id ASC
      `,
  });

  const listSessionProposedPlanRowsBySession = SqlSchema.findAll({
    Request: SessionIdLookupInput,
    Result: ProjectionSessionProposedPlanDbRowSchema,
    execute: ({ sessionId }) =>
      sql`
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

  const listSessionActivityRowsBySession = SqlSchema.findAll({
    Request: SessionIdLookupInput,
    Result: ProjectionSessionActivityDbRowSchema,
    execute: ({ sessionId }) =>
      sql`
        SELECT
          activity_id AS "activityId",
          session_id AS "sessionId",
          turn_id AS "turnId",
          tone,
          kind,
          summary,
          payload_json AS "payload",
          sequence,
          created_at AS "createdAt"
        FROM projection_session_activities
        WHERE session_id = ${sessionId}
        ORDER BY
          sequence ASC,
          created_at ASC,
          activity_id ASC
      `,
  });

  const getProviderRuntimeRowBySession = SqlSchema.findOneOption({
    Request: SessionIdLookupInput,
    Result: ProjectionProviderRuntimeDbRowSchema,
    execute: ({ sessionId }) =>
      sql`
        SELECT
          session_id AS "sessionId",
          status,
          provider_name AS "providerName",
          provider_instance_id AS "providerInstanceId",
          runtime_mode AS "runtimeMode",
          active_turn_id AS "activeTurnId",
          last_error AS "lastError",
          updated_at AS "updatedAt"
        FROM projection_session_sessions
        WHERE session_id = ${sessionId}
        LIMIT 1
      `,
  });

  const getLatestTurnRowBySession = SqlSchema.findOneOption({
    Request: SessionIdLookupInput,
    Result: ProjectionLatestTurnDbRowSchema,
    execute: ({ sessionId }) =>
      sql`
        SELECT
          turns.session_id AS "sessionId",
          turns.turn_id AS "turnId",
          turns.state,
          turns.requested_at AS "requestedAt",
          turns.started_at AS "startedAt",
          turns.completed_at AS "completedAt",
          turns.assistant_message_id AS "assistantMessageId",
          turns.source_proposed_plan_session_id AS "sourceProposedPlanSessionId",
          turns.source_proposed_plan_id AS "sourceProposedPlanId"
        FROM projection_sessions sessions
        JOIN projection_turns turns
          ON turns.session_id = sessions.session_id
          AND turns.turn_id = sessions.latest_turn_id
        WHERE sessions.session_id = ${sessionId}
          AND sessions.deleted_at IS NULL
          AND sessions.archived_at IS NULL
        LIMIT 1
      `,
  });

  const listCheckpointRowsBySession = SqlSchema.findAll({
    Request: SessionIdLookupInput,
    Result: ProjectionCheckpointDbRowSchema,
    execute: ({ sessionId }) =>
      sql`
        SELECT
          session_id AS "sessionId",
          turn_id AS "turnId",
          checkpoint_turn_count AS "checkpointTurnCount",
          checkpoint_ref AS "checkpointRef",
          checkpoint_status AS "status",
          checkpoint_files_json AS "files",
          assistant_message_id AS "assistantMessageId",
          completed_at AS "completedAt"
        FROM projection_turns
        WHERE session_id = ${sessionId}
          AND checkpoint_turn_count IS NOT NULL
        ORDER BY checkpoint_turn_count ASC
      `,
  });

  const getFullSessionDiffContextRow = SqlSchema.findOneOption({
    Request: FullSessionDiffContextLookupInput,
    Result: ProjectionFullSessionDiffContextRowSchema,
    execute: ({ sessionId, checkpointTurnCount }) =>
      sql`
        SELECT
          sessions.session_id AS "sessionId",
          sessions.project_id AS "projectId",
          projects.workspace_root AS "workspaceRoot",
          sessions.worktree_path AS "worktreePath",
          (
            SELECT MAX(turns.checkpoint_turn_count)
            FROM projection_turns AS turns
            WHERE turns.session_id = sessions.session_id
              AND turns.checkpoint_turn_count IS NOT NULL
          ) AS "latestCheckpointTurnCount",
          (
            SELECT turns.checkpoint_ref
            FROM projection_turns AS turns
            WHERE turns.session_id = sessions.session_id
              AND turns.checkpoint_turn_count = ${checkpointTurnCount}
            LIMIT 1
          ) AS "toCheckpointRef"
        FROM projection_sessions AS sessions
        INNER JOIN projection_projects AS projects
          ON projects.project_id = sessions.project_id
        WHERE sessions.session_id = ${sessionId}
          AND sessions.deleted_at IS NULL
        LIMIT 1
      `,
  });

  const getSnapshot: ProjectionSnapshotQueryShape["getSnapshot"] = () =>
    sql
      .withTransaction(
        Effect.all([
          listProjectRows(undefined).pipe(
            Effect.mapError(
              toPersistenceSqlOrDecodeError(
                "ProjectionSnapshotQuery.getSnapshot:listProjects:query",
                "ProjectionSnapshotQuery.getSnapshot:listProjects:decodeRows",
              ),
            ),
          ),
          listSessionRows(undefined).pipe(
            Effect.mapError(
              toPersistenceSqlOrDecodeError(
                "ProjectionSnapshotQuery.getSnapshot:listSessions:query",
                "ProjectionSnapshotQuery.getSnapshot:listSessions:decodeRows",
              ),
            ),
          ),
          listSessionMessageRows(undefined).pipe(
            Effect.mapError(
              toPersistenceSqlOrDecodeError(
                "ProjectionSnapshotQuery.getSnapshot:listSessionMessages:query",
                "ProjectionSnapshotQuery.getSnapshot:listSessionMessages:decodeRows",
              ),
            ),
          ),
          listSessionProposedPlanRows(undefined).pipe(
            Effect.mapError(
              toPersistenceSqlOrDecodeError(
                "ProjectionSnapshotQuery.getSnapshot:listSessionProposedPlans:query",
                "ProjectionSnapshotQuery.getSnapshot:listSessionProposedPlans:decodeRows",
              ),
            ),
          ),
          listSessionActivityRows(undefined).pipe(
            Effect.mapError(
              toPersistenceSqlOrDecodeError(
                "ProjectionSnapshotQuery.getSnapshot:listSessionActivities:query",
                "ProjectionSnapshotQuery.getSnapshot:listSessionActivities:decodeRows",
              ),
            ),
          ),
          listProviderRuntimeRows(undefined).pipe(
            Effect.mapError(
              toPersistenceSqlOrDecodeError(
                "ProjectionSnapshotQuery.getSnapshot:listProviderRuntimes:query",
                "ProjectionSnapshotQuery.getSnapshot:listProviderRuntimes:decodeRows",
              ),
            ),
          ),
          listCheckpointRows(undefined).pipe(
            Effect.mapError(
              toPersistenceSqlOrDecodeError(
                "ProjectionSnapshotQuery.getSnapshot:listCheckpoints:query",
                "ProjectionSnapshotQuery.getSnapshot:listCheckpoints:decodeRows",
              ),
            ),
          ),
          listLatestTurnRows(undefined).pipe(
            Effect.mapError(
              toPersistenceSqlOrDecodeError(
                "ProjectionSnapshotQuery.getSnapshot:listLatestTurns:query",
                "ProjectionSnapshotQuery.getSnapshot:listLatestTurns:decodeRows",
              ),
            ),
          ),
          listProjectionStateRows(undefined).pipe(
            Effect.mapError(
              toPersistenceSqlOrDecodeError(
                "ProjectionSnapshotQuery.getSnapshot:listProjectionState:query",
                "ProjectionSnapshotQuery.getSnapshot:listProjectionState:decodeRows",
              ),
            ),
          ),
        ]),
      )
      .pipe(
        Effect.flatMap(
          ([
            projectRows,
            sessionRows,
            messageRows,
            proposedPlanRows,
            activityRows,
            providerRuntimeRows,
            checkpointRows,
            latestTurnRows,
            stateRows,
          ]) =>
            Effect.gen(function* () {
              const messagesBySession = new Map<string, Array<OrchestrationMessage>>();
              const proposedPlansBySession = new Map<string, Array<OrchestrationProposedPlan>>();
              const activitiesBySession = new Map<string, Array<OrchestrationSessionActivity>>();
              const checkpointsBySession = new Map<string, Array<OrchestrationCheckpointSummary>>();
              const sessionsBySession = new Map<string, OrchestrationProviderRuntime>();
              const latestTurnBySession = new Map<string, OrchestrationLatestTurn>();

              let updatedAt: string | null = null;

              for (const row of projectRows) {
                updatedAt = maxIso(updatedAt, row.updatedAt);
              }
              for (const row of sessionRows) {
                updatedAt = maxIso(updatedAt, row.updatedAt);
              }
              for (const row of stateRows) {
                updatedAt = maxIso(updatedAt, row.updatedAt);
              }

              for (const row of messageRows) {
                updatedAt = maxIso(updatedAt, row.updatedAt);
                const sessionMessages = messagesBySession.get(row.sessionId) ?? [];
                sessionMessages.push({
                  id: row.messageId,
                  role: row.role,
                  text: row.text,
                  ...(row.attachments !== null ? { attachments: row.attachments } : {}),
                  turnId: row.turnId,
                  streaming: row.isStreaming === 1,
                  createdAt: row.createdAt,
                  updatedAt: row.updatedAt,
                });
                messagesBySession.set(row.sessionId, sessionMessages);
              }

              for (const row of proposedPlanRows) {
                updatedAt = maxIso(updatedAt, row.updatedAt);
                const sessionProposedPlans = proposedPlansBySession.get(row.sessionId) ?? [];
                sessionProposedPlans.push({
                  id: row.planId,
                  turnId: row.turnId,
                  planMarkdown: row.planMarkdown,
                  implementedAt: row.implementedAt,
                  implementationSessionId: row.implementationSessionId,
                  createdAt: row.createdAt,
                  updatedAt: row.updatedAt,
                });
                proposedPlansBySession.set(row.sessionId, sessionProposedPlans);
              }

              for (const row of activityRows) {
                updatedAt = maxIso(updatedAt, row.createdAt);
                const sessionActivities = activitiesBySession.get(row.sessionId) ?? [];
                sessionActivities.push({
                  id: row.activityId,
                  tone: row.tone,
                  kind: row.kind,
                  summary: row.summary,
                  payload: row.payload,
                  turnId: row.turnId,
                  ...(row.sequence !== null ? { sequence: row.sequence } : {}),
                  createdAt: row.createdAt,
                });
                activitiesBySession.set(row.sessionId, sessionActivities);
              }

              for (const row of checkpointRows) {
                updatedAt = maxIso(updatedAt, row.completedAt);
                const sessionCheckpoints = checkpointsBySession.get(row.sessionId) ?? [];
                sessionCheckpoints.push({
                  turnId: row.turnId,
                  checkpointTurnCount: row.checkpointTurnCount,
                  checkpointRef: row.checkpointRef,
                  status: row.status,
                  files: row.files,
                  assistantMessageId: row.assistantMessageId,
                  completedAt: row.completedAt,
                });
                checkpointsBySession.set(row.sessionId, sessionCheckpoints);
              }

              for (const row of latestTurnRows) {
                updatedAt = maxIso(updatedAt, row.requestedAt);
                if (row.startedAt !== null) {
                  updatedAt = maxIso(updatedAt, row.startedAt);
                }
                if (row.completedAt !== null) {
                  updatedAt = maxIso(updatedAt, row.completedAt);
                }
                if (latestTurnBySession.has(row.sessionId)) {
                  continue;
                }
                latestTurnBySession.set(row.sessionId, {
                  turnId: row.turnId,
                  state:
                    row.state === "error"
                      ? "error"
                      : row.state === "interrupted"
                        ? "interrupted"
                        : row.state === "completed"
                          ? "completed"
                          : "running",
                  requestedAt: row.requestedAt,
                  startedAt: row.startedAt,
                  completedAt: row.completedAt,
                  assistantMessageId: row.assistantMessageId,
                  ...(row.sourceProposedPlanSessionId !== null && row.sourceProposedPlanId !== null
                    ? {
                        sourceProposedPlan: {
                          sessionId: row.sourceProposedPlanSessionId,
                          planId: row.sourceProposedPlanId,
                        },
                      }
                    : {}),
                });
              }

              for (const row of providerRuntimeRows) {
                updatedAt = maxIso(updatedAt, row.updatedAt);
                sessionsBySession.set(row.sessionId, {
                  sessionId: row.sessionId,
                  status: row.status,
                  providerName: row.providerName,
                  ...(row.providerInstanceId !== null
                    ? { providerInstanceId: row.providerInstanceId }
                    : {}),
                  runtimeMode: row.runtimeMode,
                  activeTurnId: row.activeTurnId,
                  lastError: row.lastError,
                  updatedAt: row.updatedAt,
                });
              }

              const repositoryIdentities = yield* resolveRepositoryIdentitiesForProjects(
                projectRows,
                { includeDeleted: true },
              );

              const projects: ReadonlyArray<OrchestrationProject> = projectRows.map((row) => ({
                id: row.projectId,
                title: row.title,
                workspaceRoot: row.workspaceRoot,
                repositoryIdentity: repositoryIdentities.get(row.projectId) ?? null,
                defaultModelSelection: row.defaultModelSelection,
                scripts: row.scripts,
                createdAt: row.createdAt,
                updatedAt: row.updatedAt,
                deletedAt: row.deletedAt,
              }));

              const sessions: ReadonlyArray<OrchestrationSession> = sessionRows.map((row) => ({
                id: row.sessionId,
                projectId: row.projectId,
                title: row.title,
                modelSelection: row.modelSelection,
                runtimeMode: row.runtimeMode,
                interactionMode: row.interactionMode,
                branch: row.branch,
                worktreePath: row.worktreePath,
                latestTurn: latestTurnBySession.get(row.sessionId) ?? null,
                createdAt: row.createdAt,
                updatedAt: row.updatedAt,
                archivedAt: row.archivedAt,
                deletedAt: row.deletedAt,
                messages: messagesBySession.get(row.sessionId) ?? [],
                proposedPlans: proposedPlansBySession.get(row.sessionId) ?? [],
                activities: activitiesBySession.get(row.sessionId) ?? [],
                checkpoints: checkpointsBySession.get(row.sessionId) ?? [],
                session: sessionsBySession.get(row.sessionId) ?? null,
              }));

              const snapshot = {
                snapshotSequence: computeSnapshotSequence(stateRows),
                projects,
                sessions,
                updatedAt: updatedAt ?? "1970-01-01T00:00:00.000Z",
              };

              return yield* decodeReadModel(snapshot).pipe(
                Effect.mapError(
                  toPersistenceDecodeError("ProjectionSnapshotQuery.getSnapshot:decodeReadModel"),
                ),
              );
            }),
        ),
        Effect.mapError((error) => {
          if (isPersistenceError(error)) {
            return error;
          }
          return toPersistenceSqlError("ProjectionSnapshotQuery.getSnapshot:query")(error);
        }),
      );

  const getCommandReadModel: ProjectionSnapshotQueryShape["getCommandReadModel"] = () =>
    sql
      .withTransaction(
        Effect.all([
          listProjectRows(undefined).pipe(
            Effect.mapError(
              toPersistenceSqlOrDecodeError(
                "ProjectionSnapshotQuery.getCommandReadModel:listProjects:query",
                "ProjectionSnapshotQuery.getCommandReadModel:listProjects:decodeRows",
              ),
            ),
          ),
          listSessionRows(undefined).pipe(
            Effect.mapError(
              toPersistenceSqlOrDecodeError(
                "ProjectionSnapshotQuery.getCommandReadModel:listSessions:query",
                "ProjectionSnapshotQuery.getCommandReadModel:listSessions:decodeRows",
              ),
            ),
          ),
          listSessionProposedPlanRows(undefined).pipe(
            Effect.mapError(
              toPersistenceSqlOrDecodeError(
                "ProjectionSnapshotQuery.getCommandReadModel:listSessionProposedPlans:query",
                "ProjectionSnapshotQuery.getCommandReadModel:listSessionProposedPlans:decodeRows",
              ),
            ),
          ),
          listProviderRuntimeRows(undefined).pipe(
            Effect.mapError(
              toPersistenceSqlOrDecodeError(
                "ProjectionSnapshotQuery.getCommandReadModel:listProviderRuntimes:query",
                "ProjectionSnapshotQuery.getCommandReadModel:listProviderRuntimes:decodeRows",
              ),
            ),
          ),
          listLatestTurnRows(undefined).pipe(
            Effect.mapError(
              toPersistenceSqlOrDecodeError(
                "ProjectionSnapshotQuery.getCommandReadModel:listLatestTurns:query",
                "ProjectionSnapshotQuery.getCommandReadModel:listLatestTurns:decodeRows",
              ),
            ),
          ),
          listProjectionStateRows(undefined).pipe(
            Effect.mapError(
              toPersistenceSqlOrDecodeError(
                "ProjectionSnapshotQuery.getCommandReadModel:listProjectionState:query",
                "ProjectionSnapshotQuery.getCommandReadModel:listProjectionState:decodeRows",
              ),
            ),
          ),
        ]),
      )
      .pipe(
        Effect.flatMap(
          ([
            projectRows,
            sessionRows,
            proposedPlanRows,
            providerRuntimeRows,
            latestTurnRows,
            stateRows,
          ]) =>
            Effect.sync(() => {
              let updatedAt: string | null = null;
              const projects: OrchestrationProject[] = [];
              const sessions: OrchestrationSession[] = [];

              for (let index = 0; index < projectRows.length; index += 1) {
                const row = projectRows[index];
                if (!row) {
                  continue;
                }
                updatedAt = maxIso(updatedAt, row.updatedAt);
                projects.push({
                  id: row.projectId,
                  title: row.title,
                  workspaceRoot: row.workspaceRoot,
                  defaultModelSelection: row.defaultModelSelection,
                  scripts: row.scripts,
                  createdAt: row.createdAt,
                  updatedAt: row.updatedAt,
                  deletedAt: row.deletedAt,
                });
              }
              for (let index = 0; index < sessionRows.length; index += 1) {
                const row = sessionRows[index];
                if (!row) {
                  continue;
                }
                updatedAt = maxIso(updatedAt, row.updatedAt);
              }
              for (let index = 0; index < proposedPlanRows.length; index += 1) {
                const row = proposedPlanRows[index];
                if (!row) {
                  continue;
                }
                updatedAt = maxIso(updatedAt, row.updatedAt);
              }
              for (let index = 0; index < providerRuntimeRows.length; index += 1) {
                const row = providerRuntimeRows[index];
                if (!row) {
                  continue;
                }
                updatedAt = maxIso(updatedAt, row.updatedAt);
              }
              for (let index = 0; index < latestTurnRows.length; index += 1) {
                const row = latestTurnRows[index];
                if (!row) {
                  continue;
                }
                updatedAt = maxIso(updatedAt, row.requestedAt);
                if (row.startedAt !== null) {
                  updatedAt = maxIso(updatedAt, row.startedAt);
                }
                if (row.completedAt !== null) {
                  updatedAt = maxIso(updatedAt, row.completedAt);
                }
              }
              for (let index = 0; index < stateRows.length; index += 1) {
                const row = stateRows[index];
                if (!row) {
                  continue;
                }
                updatedAt = maxIso(updatedAt, row.updatedAt);
              }

              const latestTurnBySession = new Map<string, OrchestrationLatestTurn>();
              for (let index = 0; index < latestTurnRows.length; index += 1) {
                const row = latestTurnRows[index];
                if (!row) {
                  continue;
                }
                latestTurnBySession.set(row.sessionId, mapLatestTurn(row));
              }
              const proposedPlansBySession = new Map<string, Array<OrchestrationProposedPlan>>();
              const sessionBySession = new Map<string, OrchestrationProviderRuntime>();

              for (let index = 0; index < providerRuntimeRows.length; index += 1) {
                const row = providerRuntimeRows[index];
                if (!row) {
                  continue;
                }
                sessionBySession.set(row.sessionId, mapSessionRow(row));
              }

              for (let index = 0; index < proposedPlanRows.length; index += 1) {
                const row = proposedPlanRows[index];
                if (!row) {
                  continue;
                }
                const sessionProposedPlans = proposedPlansBySession.get(row.sessionId) ?? [];
                sessionProposedPlans.push(mapProposedPlanRow(row));
                proposedPlansBySession.set(row.sessionId, sessionProposedPlans);
              }

              for (let index = 0; index < sessionRows.length; index += 1) {
                const row = sessionRows[index];
                if (!row) {
                  continue;
                }
                sessions.push({
                  id: row.sessionId,
                  projectId: row.projectId,
                  title: row.title,
                  modelSelection: row.modelSelection,
                  runtimeMode: row.runtimeMode,
                  interactionMode: row.interactionMode,
                  branch: row.branch,
                  worktreePath: row.worktreePath,
                  latestTurn: latestTurnBySession.get(row.sessionId) ?? null,
                  createdAt: row.createdAt,
                  updatedAt: row.updatedAt,
                  archivedAt: row.archivedAt,
                  deletedAt: row.deletedAt,
                  messages: [],
                  proposedPlans: proposedPlansBySession.get(row.sessionId) ?? [],
                  activities: [],
                  checkpoints: [],
                  session: sessionBySession.get(row.sessionId) ?? null,
                });
              }

              return {
                snapshotSequence: computeSnapshotSequence(stateRows),
                projects,
                sessions,
                updatedAt: updatedAt ?? "1970-01-01T00:00:00.000Z",
              } satisfies OrchestrationReadModel;
            }),
        ),
        Effect.mapError((error) => {
          if (isPersistenceError(error)) {
            return error;
          }
          return toPersistenceSqlError("ProjectionSnapshotQuery.getCommandReadModel:query")(error);
        }),
      );

  const getShellSnapshot: ProjectionSnapshotQueryShape["getShellSnapshot"] = () =>
    sql
      .withTransaction(
        Effect.all([
          listProjectRows(undefined).pipe(
            Effect.mapError(
              toPersistenceSqlOrDecodeError(
                "ProjectionSnapshotQuery.getShellSnapshot:listProjects:query",
                "ProjectionSnapshotQuery.getShellSnapshot:listProjects:decodeRows",
              ),
            ),
          ),
          listActiveSessionRows(undefined).pipe(
            Effect.mapError(
              toPersistenceSqlOrDecodeError(
                "ProjectionSnapshotQuery.getShellSnapshot:listSessions:query",
                "ProjectionSnapshotQuery.getShellSnapshot:listSessions:decodeRows",
              ),
            ),
          ),
          listActiveProviderRuntimeRows(undefined).pipe(
            Effect.mapError(
              toPersistenceSqlOrDecodeError(
                "ProjectionSnapshotQuery.getShellSnapshot:listProviderRuntimes:query",
                "ProjectionSnapshotQuery.getShellSnapshot:listProviderRuntimes:decodeRows",
              ),
            ),
          ),
          listActiveLatestTurnRows(undefined).pipe(
            Effect.mapError(
              toPersistenceSqlOrDecodeError(
                "ProjectionSnapshotQuery.getShellSnapshot:listLatestTurns:query",
                "ProjectionSnapshotQuery.getShellSnapshot:listLatestTurns:decodeRows",
              ),
            ),
          ),
          listProjectionStateRows(undefined).pipe(
            Effect.mapError(
              toPersistenceSqlOrDecodeError(
                "ProjectionSnapshotQuery.getShellSnapshot:listProjectionState:query",
                "ProjectionSnapshotQuery.getShellSnapshot:listProjectionState:decodeRows",
              ),
            ),
          ),
        ]),
      )
      .pipe(
        Effect.flatMap(
          ([projectRows, sessionRows, providerRuntimeRows, latestTurnRows, stateRows]) =>
            Effect.gen(function* () {
              let updatedAt: string | null = null;
              for (const row of projectRows) {
                updatedAt = maxIso(updatedAt, row.updatedAt);
              }
              for (const row of sessionRows) {
                updatedAt = maxIso(updatedAt, row.updatedAt);
              }
              for (const row of providerRuntimeRows) {
                updatedAt = maxIso(updatedAt, row.updatedAt);
              }
              for (const row of latestTurnRows) {
                updatedAt = maxIso(updatedAt, row.requestedAt);
                if (row.startedAt !== null) {
                  updatedAt = maxIso(updatedAt, row.startedAt);
                }
                if (row.completedAt !== null) {
                  updatedAt = maxIso(updatedAt, row.completedAt);
                }
              }
              for (const row of stateRows) {
                updatedAt = maxIso(updatedAt, row.updatedAt);
              }

              const repositoryIdentities =
                yield* resolveRepositoryIdentitiesForProjects(projectRows);
              const latestTurnBySession = new Map(
                latestTurnRows.map((row) => [row.sessionId, mapLatestTurn(row)] as const),
              );
              const sessionBySession = new Map(
                providerRuntimeRows.map((row) => [row.sessionId, mapSessionRow(row)] as const),
              );

              const snapshot = {
                snapshotSequence: computeSnapshotSequence(stateRows),
                projects: projectRows
                  .filter((row) => row.deletedAt === null)
                  .map((row) =>
                    mapProjectShellRow(row, repositoryIdentities.get(row.projectId) ?? null),
                  ),
                sessions: sessionRows
                  .filter((row) => row.deletedAt === null)
                  .map(
                    (row): OrchestrationSessionShell => ({
                      id: row.sessionId,
                      projectId: row.projectId,
                      title: row.title,
                      modelSelection: row.modelSelection,
                      runtimeMode: row.runtimeMode,
                      interactionMode: row.interactionMode,
                      branch: row.branch,
                      worktreePath: row.worktreePath,
                      latestTurn: latestTurnBySession.get(row.sessionId) ?? null,
                      createdAt: row.createdAt,
                      updatedAt: row.updatedAt,
                      archivedAt: row.archivedAt,
                      session: sessionBySession.get(row.sessionId) ?? null,
                      latestUserMessageAt: row.latestUserMessageAt,
                      hasPendingApprovals: row.pendingApprovalCount > 0,
                      hasPendingUserInput: row.pendingUserInputCount > 0,
                      hasActionableProposedPlan: row.hasActionableProposedPlan > 0,
                    }),
                  ),
                updatedAt: updatedAt ?? "1970-01-01T00:00:00.000Z",
              };

              return yield* decodeShellSnapshot(snapshot).pipe(
                Effect.mapError(
                  toPersistenceDecodeError(
                    "ProjectionSnapshotQuery.getShellSnapshot:decodeShellSnapshot",
                  ),
                ),
              );
            }),
        ),
        Effect.mapError((error) => {
          if (isPersistenceError(error)) {
            return error;
          }
          return toPersistenceSqlError("ProjectionSnapshotQuery.getShellSnapshot:query")(error);
        }),
      );

  const getArchivedShellSnapshot: ProjectionSnapshotQueryShape["getArchivedShellSnapshot"] = () =>
    sql
      .withTransaction(
        Effect.all([
          listProjectRows(undefined).pipe(
            Effect.mapError(
              toPersistenceSqlOrDecodeError(
                "ProjectionSnapshotQuery.getArchivedShellSnapshot:listProjects:query",
                "ProjectionSnapshotQuery.getArchivedShellSnapshot:listProjects:decodeRows",
              ),
            ),
          ),
          listArchivedSessionRows(undefined).pipe(
            Effect.mapError(
              toPersistenceSqlOrDecodeError(
                "ProjectionSnapshotQuery.getArchivedShellSnapshot:listSessions:query",
                "ProjectionSnapshotQuery.getArchivedShellSnapshot:listSessions:decodeRows",
              ),
            ),
          ),
          listArchivedProviderRuntimeRows(undefined).pipe(
            Effect.mapError(
              toPersistenceSqlOrDecodeError(
                "ProjectionSnapshotQuery.getArchivedShellSnapshot:listProviderRuntimes:query",
                "ProjectionSnapshotQuery.getArchivedShellSnapshot:listProviderRuntimes:decodeRows",
              ),
            ),
          ),
          listArchivedLatestTurnRows(undefined).pipe(
            Effect.mapError(
              toPersistenceSqlOrDecodeError(
                "ProjectionSnapshotQuery.getArchivedShellSnapshot:listLatestTurns:query",
                "ProjectionSnapshotQuery.getArchivedShellSnapshot:listLatestTurns:decodeRows",
              ),
            ),
          ),
          listProjectionStateRows(undefined).pipe(
            Effect.mapError(
              toPersistenceSqlOrDecodeError(
                "ProjectionSnapshotQuery.getArchivedShellSnapshot:listProjectionState:query",
                "ProjectionSnapshotQuery.getArchivedShellSnapshot:listProjectionState:decodeRows",
              ),
            ),
          ),
        ]),
      )
      .pipe(
        Effect.flatMap(
          ([projectRows, sessionRows, providerRuntimeRows, latestTurnRows, stateRows]) =>
            Effect.gen(function* () {
              let updatedAt: string | null = null;
              for (const row of projectRows) {
                updatedAt = maxIso(updatedAt, row.updatedAt);
              }
              for (const row of sessionRows) {
                updatedAt = maxIso(updatedAt, row.updatedAt);
              }
              for (const row of providerRuntimeRows) {
                updatedAt = maxIso(updatedAt, row.updatedAt);
              }
              for (const row of latestTurnRows) {
                updatedAt = maxIso(updatedAt, row.requestedAt);
                if (row.startedAt !== null) {
                  updatedAt = maxIso(updatedAt, row.startedAt);
                }
                if (row.completedAt !== null) {
                  updatedAt = maxIso(updatedAt, row.completedAt);
                }
              }
              for (const row of stateRows) {
                updatedAt = maxIso(updatedAt, row.updatedAt);
              }

              const activeProjectIds = new Set(sessionRows.map((row) => row.projectId));
              const repositoryIdentities = yield* resolveRepositoryIdentitiesForProjects(
                projectRows.filter((row) => activeProjectIds.has(row.projectId)),
              );
              const latestTurnBySession = new Map(
                latestTurnRows.map((row) => [row.sessionId, mapLatestTurn(row)] as const),
              );
              const sessionBySession = new Map(
                providerRuntimeRows.map((row) => [row.sessionId, mapSessionRow(row)] as const),
              );

              const snapshot = {
                snapshotSequence: computeSnapshotSequence(stateRows),
                projects: projectRows
                  .filter((row) => row.deletedAt === null && activeProjectIds.has(row.projectId))
                  .map((row) =>
                    mapProjectShellRow(row, repositoryIdentities.get(row.projectId) ?? null),
                  ),
                sessions: sessionRows.map(
                  (row): OrchestrationSessionShell => ({
                    id: row.sessionId,
                    projectId: row.projectId,
                    title: row.title,
                    modelSelection: row.modelSelection,
                    runtimeMode: row.runtimeMode,
                    interactionMode: row.interactionMode,
                    branch: row.branch,
                    worktreePath: row.worktreePath,
                    latestTurn: latestTurnBySession.get(row.sessionId) ?? null,
                    createdAt: row.createdAt,
                    updatedAt: row.updatedAt,
                    archivedAt: row.archivedAt,
                    session: sessionBySession.get(row.sessionId) ?? null,
                    latestUserMessageAt: row.latestUserMessageAt,
                    hasPendingApprovals: row.pendingApprovalCount > 0,
                    hasPendingUserInput: row.pendingUserInputCount > 0,
                    hasActionableProposedPlan: row.hasActionableProposedPlan > 0,
                  }),
                ),
                updatedAt: updatedAt ?? "1970-01-01T00:00:00.000Z",
              };

              return yield* decodeShellSnapshot(snapshot).pipe(
                Effect.mapError(
                  toPersistenceDecodeError(
                    "ProjectionSnapshotQuery.getArchivedShellSnapshot:decodeShellSnapshot",
                  ),
                ),
              );
            }),
        ),
        Effect.mapError((error) => {
          if (isPersistenceError(error)) {
            return error;
          }
          return toPersistenceSqlError("ProjectionSnapshotQuery.getArchivedShellSnapshot:query")(
            error,
          );
        }),
      );

  const getSnapshotSequence: ProjectionSnapshotQueryShape["getSnapshotSequence"] = () =>
    listProjectionStateRows(undefined).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "ProjectionSnapshotQuery.getSnapshotSequence:query",
          "ProjectionSnapshotQuery.getSnapshotSequence:decodeRows",
        ),
      ),
      Effect.map((stateRows) => ({
        snapshotSequence: computeSnapshotSequence(stateRows),
      })),
    );

  const getCounts: ProjectionSnapshotQueryShape["getCounts"] = () =>
    readProjectionCounts(undefined).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "ProjectionSnapshotQuery.getCounts:query",
          "ProjectionSnapshotQuery.getCounts:decodeRow",
        ),
      ),
      Effect.map(
        (row): ProjectionSnapshotCounts => ({
          projectCount: row.projectCount,
          sessionCount: row.sessionCount,
        }),
      ),
    );

  const getActiveProjectByWorkspaceRoot: ProjectionSnapshotQueryShape["getActiveProjectByWorkspaceRoot"] =
    (workspaceRoot) =>
      getActiveProjectRowByWorkspaceRoot({ workspaceRoot }).pipe(
        Effect.mapError(
          toPersistenceSqlOrDecodeError(
            "ProjectionSnapshotQuery.getActiveProjectByWorkspaceRoot:query",
            "ProjectionSnapshotQuery.getActiveProjectByWorkspaceRoot:decodeRow",
          ),
        ),
        Effect.flatMap((option) =>
          Option.isNone(option)
            ? Effect.succeed(Option.none<OrchestrationProject>())
            : repositoryIdentityResolver.resolve(option.value.workspaceRoot).pipe(
                Effect.map((repositoryIdentity) =>
                  Option.some({
                    id: option.value.projectId,
                    title: option.value.title,
                    workspaceRoot: option.value.workspaceRoot,
                    repositoryIdentity,
                    defaultModelSelection: option.value.defaultModelSelection,
                    scripts: option.value.scripts,
                    createdAt: option.value.createdAt,
                    updatedAt: option.value.updatedAt,
                    deletedAt: option.value.deletedAt,
                  } satisfies OrchestrationProject),
                ),
              ),
        ),
      );

  const getProjectShellById: ProjectionSnapshotQueryShape["getProjectShellById"] = (projectId) =>
    getActiveProjectRowById({ projectId }).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "ProjectionSnapshotQuery.getProjectShellById:query",
          "ProjectionSnapshotQuery.getProjectShellById:decodeRow",
        ),
      ),
      Effect.flatMap((option) =>
        Option.isNone(option)
          ? Effect.succeed(Option.none<OrchestrationProjectShell>())
          : repositoryIdentityResolver
              .resolve(option.value.workspaceRoot)
              .pipe(
                Effect.map((repositoryIdentity) =>
                  Option.some(mapProjectShellRow(option.value, repositoryIdentity)),
                ),
              ),
      ),
    );

  const getFirstActiveSessionIdByProjectId: ProjectionSnapshotQueryShape["getFirstActiveSessionIdByProjectId"] =
    (projectId) =>
      getFirstActiveSessionIdByProject({ projectId }).pipe(
        Effect.mapError(
          toPersistenceSqlOrDecodeError(
            "ProjectionSnapshotQuery.getFirstActiveSessionIdByProjectId:query",
            "ProjectionSnapshotQuery.getFirstActiveSessionIdByProjectId:decodeRow",
          ),
        ),
        Effect.map(Option.map((row) => row.sessionId)),
      );

  const getSessionCheckpointContext: ProjectionSnapshotQueryShape["getSessionCheckpointContext"] = (
    sessionId,
  ) =>
    Effect.gen(function* () {
      const sessionRow = yield* getSessionCheckpointContextSessionRow({ sessionId }).pipe(
        Effect.mapError(
          toPersistenceSqlOrDecodeError(
            "ProjectionSnapshotQuery.getSessionCheckpointContext:getSession:query",
            "ProjectionSnapshotQuery.getSessionCheckpointContext:getSession:decodeRow",
          ),
        ),
      );
      if (Option.isNone(sessionRow)) {
        return Option.none<ProjectionSessionCheckpointContext>();
      }

      const checkpointRows = yield* listCheckpointRowsBySession({ sessionId }).pipe(
        Effect.mapError(
          toPersistenceSqlOrDecodeError(
            "ProjectionSnapshotQuery.getSessionCheckpointContext:listCheckpoints:query",
            "ProjectionSnapshotQuery.getSessionCheckpointContext:listCheckpoints:decodeRows",
          ),
        ),
      );

      return Option.some({
        sessionId: sessionRow.value.sessionId,
        projectId: sessionRow.value.projectId,
        workspaceRoot: sessionRow.value.workspaceRoot,
        worktreePath: sessionRow.value.worktreePath,
        checkpoints: checkpointRows.map(
          (row): OrchestrationCheckpointSummary => ({
            turnId: row.turnId,
            checkpointTurnCount: row.checkpointTurnCount,
            checkpointRef: row.checkpointRef,
            status: row.status,
            files: row.files,
            assistantMessageId: row.assistantMessageId,
            completedAt: row.completedAt,
          }),
        ),
      });
    });

  const getFullSessionDiffContext: NonNullable<
    ProjectionSnapshotQueryShape["getFullSessionDiffContext"]
  > = (sessionId, toTurnCount) =>
    Effect.gen(function* () {
      const row = yield* getFullSessionDiffContextRow({
        sessionId,
        checkpointTurnCount: toTurnCount,
      }).pipe(
        Effect.mapError(
          toPersistenceSqlOrDecodeError(
            "ProjectionSnapshotQuery.getFullSessionDiffContext:query",
            "ProjectionSnapshotQuery.getFullSessionDiffContext:decodeRow",
          ),
        ),
      );
      if (Option.isNone(row)) {
        return Option.none<ProjectionFullSessionDiffContext>();
      }

      return Option.some({
        sessionId: row.value.sessionId,
        projectId: row.value.projectId,
        workspaceRoot: row.value.workspaceRoot,
        worktreePath: row.value.worktreePath,
        latestCheckpointTurnCount: row.value.latestCheckpointTurnCount ?? 0,
        toCheckpointRef: row.value.toCheckpointRef,
      });
    });

  const getSessionShellById: ProjectionSnapshotQueryShape["getSessionShellById"] = (sessionId) =>
    Effect.gen(function* () {
      const [sessionRow, latestTurnRow, providerRuntimeRow] = yield* Effect.all([
        getActiveSessionRowById({ sessionId }).pipe(
          Effect.mapError(
            toPersistenceSqlOrDecodeError(
              "ProjectionSnapshotQuery.getSessionShellById:getSession:query",
              "ProjectionSnapshotQuery.getSessionShellById:getSession:decodeRow",
            ),
          ),
        ),
        getLatestTurnRowBySession({ sessionId }).pipe(
          Effect.mapError(
            toPersistenceSqlOrDecodeError(
              "ProjectionSnapshotQuery.getSessionShellById:getLatestTurn:query",
              "ProjectionSnapshotQuery.getSessionShellById:getLatestTurn:decodeRow",
            ),
          ),
        ),
        getProviderRuntimeRowBySession({ sessionId }).pipe(
          Effect.mapError(
            toPersistenceSqlOrDecodeError(
              "ProjectionSnapshotQuery.getSessionShellById:getSession:query",
              "ProjectionSnapshotQuery.getSessionShellById:getSession:decodeRow",
            ),
          ),
        ),
      ]);

      if (Option.isNone(sessionRow)) {
        return Option.none<OrchestrationSessionShell>();
      }

      return Option.some({
        id: sessionRow.value.sessionId,
        projectId: sessionRow.value.projectId,
        title: sessionRow.value.title,
        modelSelection: sessionRow.value.modelSelection,
        runtimeMode: sessionRow.value.runtimeMode,
        interactionMode: sessionRow.value.interactionMode,
        branch: sessionRow.value.branch,
        worktreePath: sessionRow.value.worktreePath,
        latestTurn: Option.isSome(latestTurnRow) ? mapLatestTurn(latestTurnRow.value) : null,
        createdAt: sessionRow.value.createdAt,
        updatedAt: sessionRow.value.updatedAt,
        archivedAt: sessionRow.value.archivedAt,
        session: Option.isSome(providerRuntimeRow) ? mapSessionRow(providerRuntimeRow.value) : null,
        latestUserMessageAt: sessionRow.value.latestUserMessageAt,
        hasPendingApprovals: sessionRow.value.pendingApprovalCount > 0,
        hasPendingUserInput: sessionRow.value.pendingUserInputCount > 0,
        hasActionableProposedPlan: sessionRow.value.hasActionableProposedPlan > 0,
      } satisfies OrchestrationSessionShell);
    });

  const getSessionDetailById: ProjectionSnapshotQueryShape["getSessionDetailById"] = (sessionId) =>
    Effect.gen(function* () {
      const [
        sessionRow,
        messageRows,
        proposedPlanRows,
        activityRows,
        checkpointRows,
        latestTurnRow,
        providerRuntimeRow,
      ] = yield* Effect.all([
        getActiveSessionRowById({ sessionId }).pipe(
          Effect.mapError(
            toPersistenceSqlOrDecodeError(
              "ProjectionSnapshotQuery.getSessionDetailById:getSession:query",
              "ProjectionSnapshotQuery.getSessionDetailById:getSession:decodeRow",
            ),
          ),
        ),
        listSessionMessageRowsBySession({ sessionId }).pipe(
          Effect.mapError(
            toPersistenceSqlOrDecodeError(
              "ProjectionSnapshotQuery.getSessionDetailById:listMessages:query",
              "ProjectionSnapshotQuery.getSessionDetailById:listMessages:decodeRows",
            ),
          ),
        ),
        listSessionProposedPlanRowsBySession({ sessionId }).pipe(
          Effect.mapError(
            toPersistenceSqlOrDecodeError(
              "ProjectionSnapshotQuery.getSessionDetailById:listPlans:query",
              "ProjectionSnapshotQuery.getSessionDetailById:listPlans:decodeRows",
            ),
          ),
        ),
        listSessionActivityRowsBySession({ sessionId }).pipe(
          Effect.mapError(
            toPersistenceSqlOrDecodeError(
              "ProjectionSnapshotQuery.getSessionDetailById:listActivities:query",
              "ProjectionSnapshotQuery.getSessionDetailById:listActivities:decodeRows",
            ),
          ),
        ),
        listCheckpointRowsBySession({ sessionId }).pipe(
          Effect.mapError(
            toPersistenceSqlOrDecodeError(
              "ProjectionSnapshotQuery.getSessionDetailById:listCheckpoints:query",
              "ProjectionSnapshotQuery.getSessionDetailById:listCheckpoints:decodeRows",
            ),
          ),
        ),
        getLatestTurnRowBySession({ sessionId }).pipe(
          Effect.mapError(
            toPersistenceSqlOrDecodeError(
              "ProjectionSnapshotQuery.getSessionDetailById:getLatestTurn:query",
              "ProjectionSnapshotQuery.getSessionDetailById:getLatestTurn:decodeRow",
            ),
          ),
        ),
        getProviderRuntimeRowBySession({ sessionId }).pipe(
          Effect.mapError(
            toPersistenceSqlOrDecodeError(
              "ProjectionSnapshotQuery.getSessionDetailById:getSession:query",
              "ProjectionSnapshotQuery.getSessionDetailById:getSession:decodeRow",
            ),
          ),
        ),
      ]);

      if (Option.isNone(sessionRow)) {
        return Option.none<OrchestrationSession>();
      }

      const session = {
        id: sessionRow.value.sessionId,
        projectId: sessionRow.value.projectId,
        title: sessionRow.value.title,
        modelSelection: sessionRow.value.modelSelection,
        runtimeMode: sessionRow.value.runtimeMode,
        interactionMode: sessionRow.value.interactionMode,
        branch: sessionRow.value.branch,
        worktreePath: sessionRow.value.worktreePath,
        latestTurn: Option.isSome(latestTurnRow) ? mapLatestTurn(latestTurnRow.value) : null,
        createdAt: sessionRow.value.createdAt,
        updatedAt: sessionRow.value.updatedAt,
        archivedAt: sessionRow.value.archivedAt,
        deletedAt: null,
        messages: messageRows.map((row) => {
          const message = {
            id: row.messageId,
            role: row.role,
            text: row.text,
            turnId: row.turnId,
            streaming: row.isStreaming === 1,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
          };
          if (row.attachments !== null) {
            return Object.assign(message, { attachments: row.attachments });
          }
          return message;
        }),
        proposedPlans: proposedPlanRows.map(mapProposedPlanRow),
        activities: activityRows.map((row) => {
          const activity = {
            id: row.activityId,
            tone: row.tone,
            kind: row.kind,
            summary: row.summary,
            payload: row.payload,
            turnId: row.turnId,
            createdAt: row.createdAt,
          };
          if (row.sequence !== null) {
            return Object.assign(activity, { sequence: row.sequence });
          }
          return activity;
        }),
        checkpoints: checkpointRows.map((row) => ({
          turnId: row.turnId,
          checkpointTurnCount: row.checkpointTurnCount,
          checkpointRef: row.checkpointRef,
          status: row.status,
          files: row.files,
          assistantMessageId: row.assistantMessageId,
          completedAt: row.completedAt,
        })),
        session: Option.isSome(providerRuntimeRow) ? mapSessionRow(providerRuntimeRow.value) : null,
      };

      return Option.some(
        yield* decodeSession(session).pipe(
          Effect.mapError(
            toPersistenceDecodeError("ProjectionSnapshotQuery.getSessionDetailById:decodeSession"),
          ),
        ),
      );
    });

  return {
    getCommandReadModel,
    getSnapshot,
    getShellSnapshot,
    getArchivedShellSnapshot,
    getSnapshotSequence,
    getCounts,
    getActiveProjectByWorkspaceRoot,
    getProjectShellById,
    getFirstActiveSessionIdByProjectId,
    getSessionCheckpointContext,
    getFullSessionDiffContext,
    getSessionShellById,
    getSessionDetailById,
  } satisfies ProjectionSnapshotQueryShape;
});

export const OrchestrationProjectionSnapshotQueryLive = Layer.effect(
  ProjectionSnapshotQuery,
  makeProjectionSnapshotQuery,
);
