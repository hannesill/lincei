/**
 * StudyRecordReactor - server-owned study-local research-card persistence.
 *
 * Reacts to accepted research-card domain events and writes `.lincei/cards`
 * manifests as an idempotent side effect after projection state is updated.
 *
 * @module StudyRecordReactor
 */
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";

export interface StudyRecordReactorShape {
  readonly start: () => Effect.Effect<void, never, Scope.Scope>;
  readonly drain: Effect.Effect<void>;
}

export class StudyRecordReactor extends Context.Service<
  StudyRecordReactor,
  StudyRecordReactorShape
>()("t3/orchestration/Services/StudyRecordReactor") {}
