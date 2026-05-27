import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Struct from "effect/Struct";
import { ChatAttachment } from "@t3tools/contracts";

import { toPersistenceSqlError } from "../Errors.ts";
import {
  GetProjectionSessionMessageInput,
  ProjectionSessionMessageRepository,
  type ProjectionSessionMessageRepositoryShape,
  DeleteProjectionSessionMessagesInput,
  ListProjectionSessionMessagesInput,
  ProjectionSessionMessage,
} from "../Services/ProjectionSessionMessages.ts";

const ProjectionSessionMessageDbRowSchema = ProjectionSessionMessage.mapFields(
  Struct.assign({
    isStreaming: Schema.Number,
    attachments: Schema.NullOr(Schema.fromJsonString(Schema.Array(ChatAttachment))),
  }),
);

function toProjectionSessionMessage(
  row: Schema.Schema.Type<typeof ProjectionSessionMessageDbRowSchema>,
): ProjectionSessionMessage {
  return {
    messageId: row.messageId,
    sessionId: row.sessionId,
    turnId: row.turnId,
    role: row.role,
    text: row.text,
    isStreaming: row.isStreaming === 1,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ...(row.attachments !== null ? { attachments: row.attachments } : {}),
  };
}

const makeProjectionSessionMessageRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertProjectionSessionMessageRow = SqlSchema.void({
    Request: ProjectionSessionMessage,
    execute: (row) => {
      const nextAttachmentsJson =
        row.attachments !== undefined ? JSON.stringify(row.attachments) : null;
      return sql`
        INSERT INTO projection_session_messages (
          message_id,
          session_id,
          turn_id,
          role,
          text,
          attachments_json,
          is_streaming,
          created_at,
          updated_at
        )
        VALUES (
          ${row.messageId},
          ${row.sessionId},
          ${row.turnId},
          ${row.role},
          ${row.text},
          COALESCE(
            ${nextAttachmentsJson},
            (
              SELECT attachments_json
              FROM projection_session_messages
              WHERE message_id = ${row.messageId}
            )
          ),
          ${row.isStreaming ? 1 : 0},
          ${row.createdAt},
          ${row.updatedAt}
        )
        ON CONFLICT (message_id)
        DO UPDATE SET
          session_id = excluded.session_id,
          turn_id = excluded.turn_id,
          role = excluded.role,
          text = excluded.text,
          attachments_json = COALESCE(
            excluded.attachments_json,
            projection_session_messages.attachments_json
          ),
          is_streaming = excluded.is_streaming,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at
      `;
    },
  });

  const getProjectionSessionMessageRow = SqlSchema.findOneOption({
    Request: GetProjectionSessionMessageInput,
    Result: ProjectionSessionMessageDbRowSchema,
    execute: ({ messageId }) =>
      sql`
        SELECT
          message_id AS "messageId",
          session_id AS "sessionId",
          turn_id AS "turnId",
          role,
          text,
          attachments_json AS "attachments",
          is_streaming AS "isStreaming",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM projection_session_messages
        WHERE message_id = ${messageId}
        LIMIT 1
      `,
  });

  const listProjectionSessionMessageRows = SqlSchema.findAll({
    Request: ListProjectionSessionMessagesInput,
    Result: ProjectionSessionMessageDbRowSchema,
    execute: ({ sessionId }) =>
      sql`
        SELECT
          message_id AS "messageId",
          session_id AS "sessionId",
          turn_id AS "turnId",
          role,
          text,
          attachments_json AS "attachments",
          is_streaming AS "isStreaming",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM projection_session_messages
        WHERE session_id = ${sessionId}
        ORDER BY created_at ASC, message_id ASC
      `,
  });

  const deleteProjectionSessionMessageRows = SqlSchema.void({
    Request: DeleteProjectionSessionMessagesInput,
    execute: ({ sessionId }) =>
      sql`
        DELETE FROM projection_session_messages
        WHERE session_id = ${sessionId}
      `,
  });

  const upsert: ProjectionSessionMessageRepositoryShape["upsert"] = (row) =>
    upsertProjectionSessionMessageRow(row).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionSessionMessageRepository.upsert:query")),
    );

  const getByMessageId: ProjectionSessionMessageRepositoryShape["getByMessageId"] = (input) =>
    getProjectionSessionMessageRow(input).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionSessionMessageRepository.getByMessageId:query"),
      ),
      Effect.map(Option.map(toProjectionSessionMessage)),
    );

  const listBySessionId: ProjectionSessionMessageRepositoryShape["listBySessionId"] = (input) =>
    listProjectionSessionMessageRows(input).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionSessionMessageRepository.listBySessionId:query"),
      ),
      Effect.map((rows) => rows.map(toProjectionSessionMessage)),
    );

  const deleteBySessionId: ProjectionSessionMessageRepositoryShape["deleteBySessionId"] = (input) =>
    deleteProjectionSessionMessageRows(input).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionSessionMessageRepository.deleteBySessionId:query"),
      ),
    );

  return {
    upsert,
    getByMessageId,
    listBySessionId,
    deleteBySessionId,
  } satisfies ProjectionSessionMessageRepositoryShape;
});

export const ProjectionSessionMessageRepositoryLive = Layer.effect(
  ProjectionSessionMessageRepository,
  makeProjectionSessionMessageRepository,
);
