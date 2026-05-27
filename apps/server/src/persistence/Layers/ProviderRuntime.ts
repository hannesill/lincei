import { SessionId } from "@t3tools/contracts";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Struct from "effect/Struct";

import {
  toPersistenceDecodeError,
  toPersistenceSqlError,
  type ProviderRuntimeRepositoryError,
} from "../Errors.ts";
import {
  ProviderRuntime,
  ProviderRuntimeRepository,
  type ProviderRuntimeRepositoryShape,
} from "../Services/ProviderRuntime.ts";

const ProviderRuntimeDbRowSchema = ProviderRuntime.mapFields(
  Struct.assign({
    resumeCursor: Schema.NullOr(Schema.fromJsonString(Schema.Unknown)),
    runtimePayload: Schema.NullOr(Schema.fromJsonString(Schema.Unknown)),
  }),
);

const decodeRuntime = Schema.decodeUnknownEffect(ProviderRuntime);

const GetRuntimeRequestSchema = Schema.Struct({
  sessionId: SessionId,
});

const DeleteRuntimeRequestSchema = GetRuntimeRequestSchema;

function toPersistenceSqlOrDecodeError(sqlOperation: string, decodeOperation: string) {
  return (cause: unknown): ProviderRuntimeRepositoryError =>
    Schema.isSchemaError(cause)
      ? toPersistenceDecodeError(decodeOperation)(cause)
      : toPersistenceSqlError(sqlOperation)(cause);
}

const makeProviderRuntimeRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertRuntimeRow = SqlSchema.void({
    Request: ProviderRuntimeDbRowSchema,
    execute: (runtime) =>
      sql`
        INSERT INTO provider_runtime (
          session_id,
          provider_name,
          provider_instance_id,
          adapter_key,
          runtime_mode,
          status,
          last_seen_at,
          resume_cursor_json,
          runtime_payload_json
        )
        VALUES (
          ${runtime.sessionId},
          ${runtime.providerName},
          ${runtime.providerInstanceId},
          ${runtime.adapterKey},
          ${runtime.runtimeMode},
          ${runtime.status},
          ${runtime.lastSeenAt},
          ${runtime.resumeCursor},
          ${runtime.runtimePayload}
        )
        ON CONFLICT (session_id)
        DO UPDATE SET
          provider_name = excluded.provider_name,
          provider_instance_id = excluded.provider_instance_id,
          adapter_key = excluded.adapter_key,
          runtime_mode = excluded.runtime_mode,
          status = excluded.status,
          last_seen_at = excluded.last_seen_at,
          resume_cursor_json = excluded.resume_cursor_json,
          runtime_payload_json = excluded.runtime_payload_json
      `,
  });

  const getRuntimeRowBySessionId = SqlSchema.findOneOption({
    Request: GetRuntimeRequestSchema,
    Result: ProviderRuntimeDbRowSchema,
    execute: ({ sessionId }) =>
      sql`
        SELECT
          session_id AS "sessionId",
          provider_name AS "providerName",
          provider_instance_id AS "providerInstanceId",
          adapter_key AS "adapterKey",
          runtime_mode AS "runtimeMode",
          status,
          last_seen_at AS "lastSeenAt",
          resume_cursor_json AS "resumeCursor",
          runtime_payload_json AS "runtimePayload"
        FROM provider_runtime
        WHERE session_id = ${sessionId}
      `,
  });

  const listRuntimeRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProviderRuntimeDbRowSchema,
    execute: () =>
      sql`
        SELECT
          session_id AS "sessionId",
          provider_name AS "providerName",
          provider_instance_id AS "providerInstanceId",
          adapter_key AS "adapterKey",
          runtime_mode AS "runtimeMode",
          status,
          last_seen_at AS "lastSeenAt",
          resume_cursor_json AS "resumeCursor",
          runtime_payload_json AS "runtimePayload"
        FROM provider_runtime
        ORDER BY last_seen_at ASC, session_id ASC
      `,
  });

  const deleteRuntimeBySessionId = SqlSchema.void({
    Request: DeleteRuntimeRequestSchema,
    execute: ({ sessionId }) =>
      sql`
        DELETE FROM provider_runtime
        WHERE session_id = ${sessionId}
      `,
  });

  const upsert: ProviderRuntimeRepositoryShape["upsert"] = (runtime) =>
    upsertRuntimeRow(runtime).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "ProviderRuntimeRepository.upsert:query",
          "ProviderRuntimeRepository.upsert:encodeRequest",
        ),
      ),
    );

  const getBySessionId: ProviderRuntimeRepositoryShape["getBySessionId"] = (input) =>
    getRuntimeRowBySessionId(input).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "ProviderRuntimeRepository.getBySessionId:query",
          "ProviderRuntimeRepository.getBySessionId:decodeRow",
        ),
      ),
      Effect.flatMap((runtimeRowOption) =>
        Option.match(runtimeRowOption, {
          onNone: () => Effect.succeed(Option.none()),
          onSome: (row) =>
            decodeRuntime(row).pipe(
              Effect.mapError(
                toPersistenceDecodeError("ProviderRuntimeRepository.getBySessionId:rowToRuntime"),
              ),
              Effect.map((runtime) => Option.some(runtime)),
            ),
        }),
      ),
    );

  const list: ProviderRuntimeRepositoryShape["list"] = () =>
    listRuntimeRows(undefined).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "ProviderRuntimeRepository.list:query",
          "ProviderRuntimeRepository.list:decodeRows",
        ),
      ),
      Effect.flatMap((rows) =>
        Effect.forEach(
          rows,
          (row) =>
            decodeRuntime(row).pipe(
              Effect.mapError(
                toPersistenceDecodeError("ProviderRuntimeRepository.list:rowToRuntime"),
              ),
            ),
          { concurrency: "unbounded" },
        ),
      ),
    );

  const deleteBySessionId: ProviderRuntimeRepositoryShape["deleteBySessionId"] = (input) =>
    deleteRuntimeBySessionId(input).pipe(
      Effect.mapError(toPersistenceSqlError("ProviderRuntimeRepository.deleteBySessionId:query")),
    );

  return {
    upsert,
    getBySessionId,
    list,
    deleteBySessionId,
  } satisfies ProviderRuntimeRepositoryShape;
});

export const ProviderRuntimeRepositoryLive = Layer.effect(
  ProviderRuntimeRepository,
  makeProviderRuntimeRepository,
);
