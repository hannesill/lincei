/**
 * SessionDeletionReactor - Session deletion cleanup reactor service interface.
 *
 * Owns background workers that react to session deletion domain events and
 * perform best-effort runtime cleanup for provider sessions and terminals.
 *
 * @module SessionDeletionReactor
 */
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";

/**
 * SessionDeletionReactorShape - Service API for session deletion cleanup.
 */
export interface SessionDeletionReactorShape {
  /**
   * Start reacting to session.deleted orchestration domain events.
   *
   * The returned effect must be run in a scope so all worker fibers can be
   * finalized on shutdown.
   */
  readonly start: () => Effect.Effect<void, never, Scope.Scope>;

  /**
   * Resolves when the internal processing queue is empty and idle.
   * Intended for test use to replace timing-sensitive sleeps.
   */
  readonly drain: Effect.Effect<void>;
}

/**
 * SessionDeletionReactor - Service tag for session deletion cleanup workers.
 */
export class SessionDeletionReactor extends Context.Service<
  SessionDeletionReactor,
  SessionDeletionReactorShape
>()("t3/orchestration/Services/SessionDeletionReactor") {}
