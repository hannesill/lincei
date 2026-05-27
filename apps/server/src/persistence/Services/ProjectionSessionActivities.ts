/**
 * ProjectionSessionActivityRepository - Projection repository interface for session activity.
 *
 * Owns persistence operations for activity timeline entries projected from
 * orchestration events.
 *
 * @module ProjectionSessionActivityRepository
 */
import {
  EventId,
  IsoDateTime,
  NonNegativeInt,
  OrchestrationSessionActivityTone,
  SessionId,
  TurnId,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

import type { ProjectionRepositoryError } from "../Errors.ts";

export const ProjectionSessionActivity = Schema.Struct({
  activityId: EventId,
  sessionId: SessionId,
  turnId: Schema.NullOr(TurnId),
  tone: OrchestrationSessionActivityTone,
  kind: Schema.String,
  summary: Schema.String,
  payload: Schema.Unknown,
  sequence: Schema.optional(NonNegativeInt),
  createdAt: IsoDateTime,
});
export type ProjectionSessionActivity = typeof ProjectionSessionActivity.Type;

export const ListProjectionSessionActivitiesInput = Schema.Struct({
  sessionId: SessionId,
});
export type ListProjectionSessionActivitiesInput = typeof ListProjectionSessionActivitiesInput.Type;

export const DeleteProjectionSessionActivitiesInput = Schema.Struct({
  sessionId: SessionId,
});
export type DeleteProjectionSessionActivitiesInput =
  typeof DeleteProjectionSessionActivitiesInput.Type;

/**
 * ProjectionSessionActivityRepositoryShape - Service API for projected session activity.
 */
export interface ProjectionSessionActivityRepositoryShape {
  /**
   * Insert or replace a projected session activity row.
   *
   * Upserts by `activityId` and JSON-encodes payload.
   */
  readonly upsert: (
    row: ProjectionSessionActivity,
  ) => Effect.Effect<void, ProjectionRepositoryError>;

  /**
   * List projected session activity rows for a session.
   *
   * Returned in ascending runtime sequence order (or creation order when
   * sequence is unavailable).
   */
  readonly listBySessionId: (
    input: ListProjectionSessionActivitiesInput,
  ) => Effect.Effect<ReadonlyArray<ProjectionSessionActivity>, ProjectionRepositoryError>;

  /**
   * Delete projected session activity rows by session.
   */
  readonly deleteBySessionId: (
    input: DeleteProjectionSessionActivitiesInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
}

/**
 * ProjectionSessionActivityRepository - Service tag for session activity persistence.
 */
export class ProjectionSessionActivityRepository extends Context.Service<
  ProjectionSessionActivityRepository,
  ProjectionSessionActivityRepositoryShape
>()("t3/persistence/Services/ProjectionSessionActivities/ProjectionSessionActivityRepository") {}
