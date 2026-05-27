/**
 * ProjectionProviderRuntimeRepository - Repository interface for session sessions.
 *
 * Owns persistence operations for projected provider-session linkage and
 * runtime status for each session.
 *
 * @module ProjectionProviderRuntimeRepository
 */
import {
  RuntimeMode,
  IsoDateTime,
  OrchestrationProviderRuntimeStatus,
  ProviderInstanceId,
  SessionId,
  TurnId,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

import type { ProjectionRepositoryError } from "../Errors.ts";

export const ProjectionProviderRuntime = Schema.Struct({
  sessionId: SessionId,
  status: OrchestrationProviderRuntimeStatus,
  providerName: Schema.NullOr(Schema.String),
  providerInstanceId: Schema.NullOr(ProviderInstanceId),
  runtimeMode: RuntimeMode,
  activeTurnId: Schema.NullOr(TurnId),
  lastError: Schema.NullOr(Schema.String),
  updatedAt: IsoDateTime,
});
export type ProjectionProviderRuntime = typeof ProjectionProviderRuntime.Type;

export const GetProjectionProviderRuntimeInput = Schema.Struct({
  sessionId: SessionId,
});
export type GetProjectionProviderRuntimeInput = typeof GetProjectionProviderRuntimeInput.Type;

export const DeleteProjectionProviderRuntimeInput = Schema.Struct({
  sessionId: SessionId,
});
export type DeleteProjectionProviderRuntimeInput = typeof DeleteProjectionProviderRuntimeInput.Type;

/**
 * ProjectionProviderRuntimeRepositoryShape - Service API for projected session sessions.
 */
export interface ProjectionProviderRuntimeRepositoryShape {
  /**
   * Insert or replace a projected session-session row.
   *
   * Upserts by `sessionId`.
   */
  readonly upsert: (
    row: ProjectionProviderRuntime,
  ) => Effect.Effect<void, ProjectionRepositoryError>;

  /**
   * Read projected session-session state by session id.
   */
  readonly getBySessionId: (
    input: GetProjectionProviderRuntimeInput,
  ) => Effect.Effect<Option.Option<ProjectionProviderRuntime>, ProjectionRepositoryError>;

  /**
   * Delete projected session-session state by session id.
   */
  readonly deleteBySessionId: (
    input: DeleteProjectionProviderRuntimeInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
}

/**
 * ProjectionProviderRuntimeRepository - Service tag for session-session persistence.
 */
export class ProjectionProviderRuntimeRepository extends Context.Service<
  ProjectionProviderRuntimeRepository,
  ProjectionProviderRuntimeRepositoryShape
>()("t3/persistence/Services/ProjectionProviderRuntimes/ProjectionProviderRuntimeRepository") {}
