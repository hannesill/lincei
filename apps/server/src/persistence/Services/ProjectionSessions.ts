/**
 * ProjectionSessionRepository - Projection repository interface for sessions.
 *
 * Owns persistence operations for projected session records in the
 * orchestration read model.
 *
 * @module ProjectionSessionRepository
 */
import {
  IsoDateTime,
  ModelSelection,
  NonNegativeInt,
  ProjectId,
  ProviderInteractionMode,
  RuntimeMode,
  SessionId,
  TurnId,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

import type { ProjectionRepositoryError } from "../Errors.ts";

export const ProjectionSession = Schema.Struct({
  sessionId: SessionId,
  projectId: ProjectId,
  title: Schema.String,
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode,
  interactionMode: ProviderInteractionMode,
  workflowId: Schema.NullOr(Schema.String),
  workflowVersion: Schema.NullOr(Schema.String),
  branch: Schema.NullOr(Schema.String),
  worktreePath: Schema.NullOr(Schema.String),
  latestTurnId: Schema.NullOr(TurnId),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  archivedAt: Schema.NullOr(IsoDateTime),
  settledOverride: Schema.NullOr(Schema.Literals(["settled", "active"])),
  settledAt: Schema.NullOr(IsoDateTime),
  snoozedUntil: Schema.NullOr(IsoDateTime),
  snoozedAt: Schema.NullOr(IsoDateTime),
  latestUserMessageAt: Schema.NullOr(IsoDateTime),
  pendingApprovalCount: NonNegativeInt,
  pendingUserInputCount: NonNegativeInt,
  pendingRequestRaisedAt: Schema.NullOr(IsoDateTime),
  hasActionableProposedPlan: NonNegativeInt,
  deletedAt: Schema.NullOr(IsoDateTime),
});
export type ProjectionSession = typeof ProjectionSession.Type;

export const GetProjectionSessionInput = Schema.Struct({
  sessionId: SessionId,
});
export type GetProjectionSessionInput = typeof GetProjectionSessionInput.Type;

export const DeleteProjectionSessionInput = Schema.Struct({
  sessionId: SessionId,
});
export type DeleteProjectionSessionInput = typeof DeleteProjectionSessionInput.Type;

export const ListProjectionSessionsByProjectInput = Schema.Struct({
  projectId: ProjectId,
});
export type ListProjectionSessionsByProjectInput = typeof ListProjectionSessionsByProjectInput.Type;

/**
 * ProjectionSessionRepositoryShape - Service API for projected session records.
 */
export interface ProjectionSessionRepositoryShape {
  /**
   * Insert or replace a projected session row.
   *
   * Upserts by `sessionId`.
   */
  readonly upsert: (session: ProjectionSession) => Effect.Effect<void, ProjectionRepositoryError>;

  /**
   * Read a projected session row by id.
   */
  readonly getById: (
    input: GetProjectionSessionInput,
  ) => Effect.Effect<Option.Option<ProjectionSession>, ProjectionRepositoryError>;

  /**
   * List projected sessions for a project.
   *
   * Returned in deterministic creation order.
   */
  readonly listByProjectId: (
    input: ListProjectionSessionsByProjectInput,
  ) => Effect.Effect<ReadonlyArray<ProjectionSession>, ProjectionRepositoryError>;

  /**
   * List every projected session in deterministic creation order.
   */
  readonly listAll: () => Effect.Effect<
    ReadonlyArray<ProjectionSession>,
    ProjectionRepositoryError
  >;

  /**
   * Soft-delete a projected session row by id.
   */
  readonly deleteById: (
    input: DeleteProjectionSessionInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
}

/**
 * ProjectionSessionRepository - Service tag for session projection persistence.
 */
export class ProjectionSessionRepository extends Context.Service<
  ProjectionSessionRepository,
  ProjectionSessionRepositoryShape
>()("t3/persistence/Services/ProjectionSessions/ProjectionSessionRepository") {}
