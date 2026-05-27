/**
 * ProjectionCheckpointRepository - Projection repository interface for checkpoints.
 *
 * Owns persistence operations for projected checkpoint summaries in session
 * timelines.
 *
 * @module ProjectionCheckpointRepository
 */
import {
  CheckpointRef,
  IsoDateTime,
  MessageId,
  NonNegativeInt,
  OrchestrationCheckpointFile,
  OrchestrationCheckpointStatus,
  SessionId,
  TurnId,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Context from "effect/Context";
import * as Schema from "effect/Schema";
import type * as Effect from "effect/Effect";

import type { ProjectionRepositoryError } from "../Errors.ts";

export const ProjectionCheckpoint = Schema.Struct({
  sessionId: SessionId,
  turnId: TurnId,
  checkpointTurnCount: NonNegativeInt,
  checkpointRef: CheckpointRef,
  status: OrchestrationCheckpointStatus,
  files: Schema.Array(OrchestrationCheckpointFile),
  assistantMessageId: Schema.NullOr(MessageId),
  completedAt: IsoDateTime,
});
export type ProjectionCheckpoint = typeof ProjectionCheckpoint.Type;

export const ListBySessionIdInput = Schema.Struct({
  sessionId: SessionId,
});
export type ListBySessionIdInput = typeof ListBySessionIdInput.Type;

export const GetBySessionAndTurnCountInput = Schema.Struct({
  sessionId: SessionId,
  checkpointTurnCount: NonNegativeInt,
});
export type GetBySessionAndTurnCountInput = typeof GetBySessionAndTurnCountInput.Type;

export const DeleteBySessionIdInput = Schema.Struct({
  sessionId: SessionId,
});
export type DeleteBySessionIdInput = typeof DeleteBySessionIdInput.Type;

/**
 * ProjectionCheckpointRepositoryShape - Service API for projected checkpoints.
 */
export interface ProjectionCheckpointRepositoryShape {
  /**
   * Insert or replace a projected checkpoint row.
   *
   * Upserts by composite key `(sessionId, checkpointTurnCount)`.
   */
  readonly upsert: (row: ProjectionCheckpoint) => Effect.Effect<void, ProjectionRepositoryError>;

  /**
   * List projected checkpoints for a session.
   *
   * Returned in ascending checkpoint turn-count order.
   */
  readonly listBySessionId: (
    input: ListBySessionIdInput,
  ) => Effect.Effect<ReadonlyArray<ProjectionCheckpoint>, ProjectionRepositoryError>;

  /**
   * Read a projected checkpoint by session and turn-count key.
   */
  readonly getBySessionAndTurnCount: (
    input: GetBySessionAndTurnCountInput,
  ) => Effect.Effect<Option.Option<ProjectionCheckpoint>, ProjectionRepositoryError>;

  /**
   * Delete projected checkpoint rows by session.
   */
  readonly deleteBySessionId: (
    input: DeleteBySessionIdInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
}

/**
 * ProjectionCheckpointRepository - Service tag for checkpoint projection persistence.
 */
export class ProjectionCheckpointRepository extends Context.Service<
  ProjectionCheckpointRepository,
  ProjectionCheckpointRepositoryShape
>()("t3/persistence/Services/ProjectionCheckpoints/ProjectionCheckpointRepository") {}
