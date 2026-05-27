import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";
import { NonNegativeInt } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Struct from "effect/Struct";

import { toPersistenceDecodeError, toPersistenceSqlError } from "../Errors.ts";

import {
  DeleteProjectionSessionActivitiesInput,
  ListProjectionSessionActivitiesInput,
  ProjectionSessionActivity,
  ProjectionSessionActivityRepository,
  type ProjectionSessionActivityRepositoryShape,
} from "../Services/ProjectionSessionActivities.ts";

const ProjectionSessionActivityDbRowSchema = ProjectionSessionActivity.mapFields(
  Struct.assign({
    payload: Schema.fromJsonString(Schema.Unknown),
    sequence: Schema.NullOr(NonNegativeInt),
  }),
);

function toPersistenceSqlOrDecodeError(sqlOperation: string, decodeOperation: string) {
  return (cause: unknown) =>
    Schema.isSchemaError(cause)
      ? toPersistenceDecodeError(decodeOperation)(cause)
      : toPersistenceSqlError(sqlOperation)(cause);
}

const makeProjectionSessionActivityRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertProjectionSessionActivityRow = SqlSchema.void({
    Request: ProjectionSessionActivity,
    execute: (row) =>
      sql`
            INSERT INTO projection_session_activities (
              activity_id,
              session_id,
              turn_id,
              tone,
              kind,
              summary,
              payload_json,
              sequence,
              created_at
            )
            VALUES (
              ${row.activityId},
              ${row.sessionId},
              ${row.turnId},
              ${row.tone},
              ${row.kind},
              ${row.summary},
              ${JSON.stringify(row.payload)},
              ${row.sequence ?? null},
              ${row.createdAt}
            )
            ON CONFLICT (activity_id)
            DO UPDATE SET
              session_id = excluded.session_id,
              turn_id = excluded.turn_id,
              tone = excluded.tone,
              kind = excluded.kind,
              summary = excluded.summary,
              payload_json = excluded.payload_json,
              sequence = excluded.sequence,
              created_at = excluded.created_at
          `,
  });

  const listProjectionSessionActivityRows = SqlSchema.findAll({
    Request: ListProjectionSessionActivitiesInput,
    Result: ProjectionSessionActivityDbRowSchema,
    execute: ({ sessionId }) =>
      sql`
        SELECT
          activity_id AS "activityId",
          session_id AS "sessionId",
          turn_id AS "turnId",
          tone,
          kind,
          summary,
          payload_json AS "payload",
          sequence,
          created_at AS "createdAt"
        FROM projection_session_activities
        WHERE session_id = ${sessionId}
        ORDER BY
          CASE WHEN sequence IS NULL THEN 0 ELSE 1 END ASC,
          sequence ASC,
          created_at ASC,
          activity_id ASC
      `,
  });

  const deleteProjectionSessionActivityRows = SqlSchema.void({
    Request: DeleteProjectionSessionActivitiesInput,
    execute: ({ sessionId }) =>
      sql`
        DELETE FROM projection_session_activities
        WHERE session_id = ${sessionId}
      `,
  });

  const upsert: ProjectionSessionActivityRepositoryShape["upsert"] = (row) =>
    upsertProjectionSessionActivityRow(row).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "ProjectionSessionActivityRepository.upsert:query",
          "ProjectionSessionActivityRepository.upsert:encodeRequest",
        ),
      ),
    );

  const listBySessionId: ProjectionSessionActivityRepositoryShape["listBySessionId"] = (input) =>
    listProjectionSessionActivityRows(input).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "ProjectionSessionActivityRepository.listBySessionId:query",
          "ProjectionSessionActivityRepository.listBySessionId:decodeRows",
        ),
      ),
      Effect.map((rows) =>
        rows.map((row) => ({
          activityId: row.activityId,
          sessionId: row.sessionId,
          turnId: row.turnId,
          tone: row.tone,
          kind: row.kind,
          summary: row.summary,
          payload: row.payload,
          ...(row.sequence !== null ? { sequence: row.sequence } : {}),
          createdAt: row.createdAt,
        })),
      ),
    );

  const deleteBySessionId: ProjectionSessionActivityRepositoryShape["deleteBySessionId"] = (
    input,
  ) =>
    deleteProjectionSessionActivityRows(input).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionSessionActivityRepository.deleteBySessionId:query"),
      ),
    );

  return {
    upsert,
    listBySessionId,
    deleteBySessionId,
  } satisfies ProjectionSessionActivityRepositoryShape;
});

export const ProjectionSessionActivityRepositoryLive = Layer.effect(
  ProjectionSessionActivityRepository,
  makeProjectionSessionActivityRepository,
);
