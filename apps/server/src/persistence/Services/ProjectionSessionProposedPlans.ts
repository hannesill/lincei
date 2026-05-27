import {
  IsoDateTime,
  OrchestrationProposedPlanId,
  SessionId,
  TrimmedNonEmptyString,
  TurnId,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

import type { ProjectionRepositoryError } from "../Errors.ts";

export const ProjectionSessionProposedPlan = Schema.Struct({
  planId: OrchestrationProposedPlanId,
  sessionId: SessionId,
  turnId: Schema.NullOr(TurnId),
  planMarkdown: TrimmedNonEmptyString,
  implementedAt: Schema.NullOr(IsoDateTime),
  implementationSessionId: Schema.NullOr(SessionId),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type ProjectionSessionProposedPlan = typeof ProjectionSessionProposedPlan.Type;

export const ListProjectionSessionProposedPlansInput = Schema.Struct({
  sessionId: SessionId,
});
export type ListProjectionSessionProposedPlansInput =
  typeof ListProjectionSessionProposedPlansInput.Type;

export const DeleteProjectionSessionProposedPlansInput = Schema.Struct({
  sessionId: SessionId,
});
export type DeleteProjectionSessionProposedPlansInput =
  typeof DeleteProjectionSessionProposedPlansInput.Type;

export interface ProjectionSessionProposedPlanRepositoryShape {
  readonly upsert: (
    proposedPlan: ProjectionSessionProposedPlan,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly listBySessionId: (
    input: ListProjectionSessionProposedPlansInput,
  ) => Effect.Effect<ReadonlyArray<ProjectionSessionProposedPlan>, ProjectionRepositoryError>;
  readonly deleteBySessionId: (
    input: DeleteProjectionSessionProposedPlansInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
}

export class ProjectionSessionProposedPlanRepository extends Context.Service<
  ProjectionSessionProposedPlanRepository,
  ProjectionSessionProposedPlanRepositoryShape
>()(
  "t3/persistence/Services/ProjectionSessionProposedPlans/ProjectionSessionProposedPlanRepository",
) {}
