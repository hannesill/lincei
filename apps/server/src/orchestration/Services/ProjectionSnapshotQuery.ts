/**
 * ProjectionSnapshotQuery - Read-model snapshot query service interface.
 *
 * Exposes the current orchestration projection snapshot for read-only API
 * access.
 *
 * @module ProjectionSnapshotQuery
 */
import type {
  CheckpointRef,
  OrchestrationCheckpointSummary,
  OrchestrationProject,
  OrchestrationProjectShell,
  OrchestrationReadModel,
  OrchestrationResearchCard,
  OrchestrationShellSnapshot,
  OrchestrationSession,
  OrchestrationSessionShell,
  ProjectId,
  ResearchCardId,
  SessionId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Option from "effect/Option";
import type * as Effect from "effect/Effect";

import type { ProjectionRepositoryError } from "../../persistence/Errors.ts";

export interface ProjectionSnapshotCounts {
  readonly projectCount: number;
  readonly sessionCount: number;
}

export interface ProjectionSnapshotSequence {
  readonly snapshotSequence: number;
}

export interface ProjectionSessionCheckpointContext {
  readonly sessionId: SessionId;
  readonly projectId: ProjectId;
  readonly workspaceRoot: string;
  readonly worktreePath: string | null;
  readonly checkpoints: ReadonlyArray<OrchestrationCheckpointSummary>;
}

export interface ProjectionFullSessionDiffContext {
  readonly sessionId: SessionId;
  readonly projectId: ProjectId;
  readonly workspaceRoot: string;
  readonly worktreePath: string | null;
  readonly latestCheckpointTurnCount: number;
  readonly toCheckpointRef: CheckpointRef | null;
}

/**
 * ProjectionSnapshotQueryShape - Service API for read-model snapshots.
 */
export interface ProjectionSnapshotQueryShape {
  /**
   * Read the lightweight command snapshot used to bootstrap the in-memory
   * orchestration engine without hydrating message/activity/checkpoint bodies.
   */
  readonly getCommandReadModel: () => Effect.Effect<
    OrchestrationReadModel,
    ProjectionRepositoryError
  >;

  /**
   * Read the latest orchestration projection snapshot.
   *
   * Rehydrates from projection tables and derives snapshot sequence from
   * projector cursor state.
   */
  readonly getSnapshot: () => Effect.Effect<OrchestrationReadModel, ProjectionRepositoryError>;

  /**
   * Read the latest orchestration shell snapshot.
   *
   * Returns only projects and session shell summaries so clients can bootstrap
   * lightweight navigation state without hydrating every session body.
   */
  readonly getShellSnapshot: () => Effect.Effect<
    OrchestrationShellSnapshot,
    ProjectionRepositoryError
  >;

  /**
   * Read archived session shell summaries for the archive page.
   *
   * This query is separate from the main shell snapshot so archived sessions
   * are never bootstrapped into normal navigation state.
   */
  readonly getArchivedShellSnapshot: () => Effect.Effect<
    OrchestrationShellSnapshot,
    ProjectionRepositoryError
  >;

  /**
   * Read the latest projection snapshot sequence without hydrating read-model
   * entities.
   */
  readonly getSnapshotSequence: () => Effect.Effect<
    ProjectionSnapshotSequence,
    ProjectionRepositoryError
  >;

  /**
   * Read aggregate projection counts without hydrating the full read model.
   */
  readonly getCounts: () => Effect.Effect<ProjectionSnapshotCounts, ProjectionRepositoryError>;

  /**
   * Read the active project for an exact workspace root match.
   */
  readonly getActiveProjectByWorkspaceRoot: (
    workspaceRoot: string,
  ) => Effect.Effect<Option.Option<OrchestrationProject>, ProjectionRepositoryError>;

  /**
   * Read a single active project shell row by id.
   */
  readonly getProjectShellById: (
    projectId: ProjectId,
  ) => Effect.Effect<Option.Option<OrchestrationProjectShell>, ProjectionRepositoryError>;

  /**
   * Read the earliest active session for a project.
   */
  readonly getFirstActiveSessionIdByProjectId: (
    projectId: ProjectId,
  ) => Effect.Effect<Option.Option<SessionId>, ProjectionRepositoryError>;

  /**
   * Read the checkpoint context needed to resolve a single session diff.
   */
  readonly getSessionCheckpointContext: (
    sessionId: SessionId,
  ) => Effect.Effect<Option.Option<ProjectionSessionCheckpointContext>, ProjectionRepositoryError>;

  /**
   * Read only the narrow context needed to compute a full-session diff from
   * checkpoint 0 to a specific turn count.
   */
  readonly getFullSessionDiffContext: (
    sessionId: SessionId,
    toTurnCount: number,
  ) => Effect.Effect<Option.Option<ProjectionFullSessionDiffContext>, ProjectionRepositoryError>;

  /**
   * Read a single active session shell row by id.
   */
  readonly getSessionShellById: (
    sessionId: SessionId,
  ) => Effect.Effect<Option.Option<OrchestrationSessionShell>, ProjectionRepositoryError>;

  /**
   * Read a single active session detail snapshot by id.
   */
  readonly getSessionDetailById: (
    sessionId: SessionId,
  ) => Effect.Effect<Option.Option<OrchestrationSession>, ProjectionRepositoryError>;

  /**
   * Read a single full research-card detail payload by session and card id.
   */
  readonly getResearchCardDetail: (input: {
    readonly sessionId: SessionId;
    readonly cardId: ResearchCardId;
  }) => Effect.Effect<Option.Option<OrchestrationResearchCard>, ProjectionRepositoryError>;
}

/**
 * ProjectionSnapshotQuery - Service tag for projection snapshot queries.
 */
export class ProjectionSnapshotQuery extends Context.Service<
  ProjectionSnapshotQuery,
  ProjectionSnapshotQueryShape
>()("t3/orchestration/Services/ProjectionSnapshotQuery") {}
