import {
  ResearchCardArtifactReference,
  ResearchCardProvenance,
  ResearchCardReview,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Struct from "effect/Struct";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import { toPersistenceSqlError } from "../Errors.ts";
import {
  DeleteProjectionSessionResearchCardsInput,
  GetProjectionSessionResearchCardInput,
  ListProjectionSessionResearchCardsInput,
  ProjectionSessionResearchCard,
  ProjectionSessionResearchCardRepository,
  type ProjectionSessionResearchCardRepositoryShape,
} from "../Services/ProjectionSessionResearchCards.ts";

const ProjectionSessionResearchCardDbRowSchema = ProjectionSessionResearchCard.mapFields(
  Struct.assign({
    preview: Schema.NullOr(Schema.fromJsonString(Schema.Unknown)),
    artifacts: Schema.fromJsonString(Schema.Array(ResearchCardArtifactReference)),
    provenance: Schema.fromJsonString(Schema.Array(ResearchCardProvenance)),
    review: Schema.NullOr(Schema.fromJsonString(ResearchCardReview)),
  }),
);

const encodePreviewJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const encodeArtifactsJson = Schema.encodeSync(
  Schema.fromJsonString(Schema.Array(ResearchCardArtifactReference)),
);
const encodeProvenanceJson = Schema.encodeSync(
  Schema.fromJsonString(Schema.Array(ResearchCardProvenance)),
);
const encodeReviewJson = Schema.encodeSync(Schema.fromJsonString(ResearchCardReview));

function toProjectionSessionResearchCard(
  row: Schema.Schema.Type<typeof ProjectionSessionResearchCardDbRowSchema>,
): ProjectionSessionResearchCard {
  return {
    cardId: row.cardId,
    sessionId: row.sessionId,
    turnId: row.turnId,
    type: row.type,
    status: row.status,
    title: row.title,
    ...(row.preview !== null ? { preview: row.preview } : {}),
    artifacts: row.artifacts,
    provenance: row.provenance,
    ...(row.review !== null ? { review: row.review } : {}),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

const makeProjectionSessionResearchCardRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertProjectionSessionResearchCardRow = SqlSchema.void({
    Request: ProjectionSessionResearchCard,
    execute: (row) => {
      const previewJson = row.preview !== undefined ? encodePreviewJson(row.preview) : null;
      const artifactsJson = encodeArtifactsJson(row.artifacts);
      const provenanceJson = encodeProvenanceJson(row.provenance);
      const reviewJson = row.review !== undefined ? encodeReviewJson(row.review) : null;

      return sql`
        INSERT INTO projection_session_research_cards (
          card_id,
          session_id,
          turn_id,
          type,
          status,
          title,
          preview_json,
          artifacts_json,
          provenance_json,
          review_json,
          created_at,
          updated_at
        )
        VALUES (
          ${row.cardId},
          ${row.sessionId},
          ${row.turnId},
          ${row.type},
          ${row.status},
          ${row.title},
          ${previewJson},
          ${artifactsJson},
          ${provenanceJson},
          ${reviewJson},
          ${row.createdAt},
          ${row.updatedAt}
        )
        ON CONFLICT (card_id)
        DO UPDATE SET
          session_id = excluded.session_id,
          turn_id = excluded.turn_id,
          type = excluded.type,
          status = excluded.status,
          title = excluded.title,
          preview_json = excluded.preview_json,
          artifacts_json = excluded.artifacts_json,
          provenance_json = excluded.provenance_json,
          review_json = excluded.review_json,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at
      `;
    },
  });

  const listProjectionSessionResearchCardRows = SqlSchema.findAll({
    Request: ListProjectionSessionResearchCardsInput,
    Result: ProjectionSessionResearchCardDbRowSchema,
    execute: ({ sessionId }) => sql`
      SELECT
        card_id AS "cardId",
        session_id AS "sessionId",
        turn_id AS "turnId",
        type,
        status,
        title,
        preview_json AS "preview",
        artifacts_json AS "artifacts",
        provenance_json AS "provenance",
        review_json AS "review",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM projection_session_research_cards
      WHERE session_id = ${sessionId}
      ORDER BY created_at ASC, card_id ASC
    `,
  });

  const getProjectionSessionResearchCardRow = SqlSchema.findOneOption({
    Request: GetProjectionSessionResearchCardInput,
    Result: ProjectionSessionResearchCardDbRowSchema,
    execute: ({ sessionId, cardId }) => sql`
      SELECT
        card_id AS "cardId",
        session_id AS "sessionId",
        turn_id AS "turnId",
        type,
        status,
        title,
        preview_json AS "preview",
        artifacts_json AS "artifacts",
        provenance_json AS "provenance",
        review_json AS "review",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM projection_session_research_cards
      WHERE session_id = ${sessionId}
        AND card_id = ${cardId}
      LIMIT 1
    `,
  });

  const deleteProjectionSessionResearchCardRows = SqlSchema.void({
    Request: DeleteProjectionSessionResearchCardsInput,
    execute: ({ sessionId }) => sql`
      DELETE FROM projection_session_research_cards
      WHERE session_id = ${sessionId}
    `,
  });

  const upsert: ProjectionSessionResearchCardRepositoryShape["upsert"] = (row) =>
    upsertProjectionSessionResearchCardRow(row).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionSessionResearchCardRepository.upsert:query"),
      ),
    );

  const listBySessionId: ProjectionSessionResearchCardRepositoryShape["listBySessionId"] = (
    input,
  ) =>
    listProjectionSessionResearchCardRows(input).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionSessionResearchCardRepository.listBySessionId:query"),
      ),
      Effect.map((rows) => rows.map(toProjectionSessionResearchCard)),
    );

  const getBySessionAndCardId: ProjectionSessionResearchCardRepositoryShape["getBySessionAndCardId"] =
    (input) =>
      getProjectionSessionResearchCardRow(input).pipe(
        Effect.mapError(
          toPersistenceSqlError(
            "ProjectionSessionResearchCardRepository.getBySessionAndCardId:query",
          ),
        ),
        Effect.map((row) => row.pipe(Option.map(toProjectionSessionResearchCard))),
      );

  const deleteBySessionId: ProjectionSessionResearchCardRepositoryShape["deleteBySessionId"] = (
    input,
  ) =>
    deleteProjectionSessionResearchCardRows(input).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionSessionResearchCardRepository.deleteBySessionId:query"),
      ),
    );

  return {
    upsert,
    listBySessionId,
    getBySessionAndCardId,
    deleteBySessionId,
  } satisfies ProjectionSessionResearchCardRepositoryShape;
});

export const ProjectionSessionResearchCardRepositoryLive = Layer.effect(
  ProjectionSessionResearchCardRepository,
  makeProjectionSessionResearchCardRepository,
);
