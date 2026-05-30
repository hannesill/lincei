import {
  IsoDateTime,
  ResearchCardArtifactReference,
  ResearchCardId,
  ResearchCardLifecycleStatus,
  ResearchCardProvenance,
  ResearchCardReview,
  ResearchCardType,
  SessionId,
  TrimmedNonEmptyString,
  TurnId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import type { ProjectionRepositoryError } from "../Errors.ts";

export const ProjectionSessionResearchCard = Schema.Struct({
  cardId: ResearchCardId,
  sessionId: SessionId,
  turnId: Schema.NullOr(TurnId),
  type: ResearchCardType,
  status: ResearchCardLifecycleStatus,
  title: TrimmedNonEmptyString,
  preview: Schema.optional(Schema.Unknown),
  artifacts: Schema.Array(ResearchCardArtifactReference),
  provenance: Schema.Array(ResearchCardProvenance),
  review: Schema.optional(ResearchCardReview),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type ProjectionSessionResearchCard = typeof ProjectionSessionResearchCard.Type;

export const ListProjectionSessionResearchCardsInput = Schema.Struct({
  sessionId: SessionId,
});
export type ListProjectionSessionResearchCardsInput =
  typeof ListProjectionSessionResearchCardsInput.Type;

export const DeleteProjectionSessionResearchCardsInput = Schema.Struct({
  sessionId: SessionId,
});
export type DeleteProjectionSessionResearchCardsInput =
  typeof DeleteProjectionSessionResearchCardsInput.Type;

export interface ProjectionSessionResearchCardRepositoryShape {
  readonly upsert: (
    researchCard: ProjectionSessionResearchCard,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly listBySessionId: (
    input: ListProjectionSessionResearchCardsInput,
  ) => Effect.Effect<ReadonlyArray<ProjectionSessionResearchCard>, ProjectionRepositoryError>;
  readonly deleteBySessionId: (
    input: DeleteProjectionSessionResearchCardsInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
}

export class ProjectionSessionResearchCardRepository extends Context.Service<
  ProjectionSessionResearchCardRepository,
  ProjectionSessionResearchCardRepositoryShape
>()(
  "t3/persistence/Services/ProjectionSessionResearchCards/ProjectionSessionResearchCardRepository",
) {}
