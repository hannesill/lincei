import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { toPersistenceSqlError } from "../Errors.ts";

import {
  ProjectionProviderRuntime,
  ProjectionProviderRuntimeRepository,
  type ProjectionProviderRuntimeRepositoryShape,
  DeleteProjectionProviderRuntimeInput,
  GetProjectionProviderRuntimeInput,
} from "../Services/ProjectionProviderRuntimes.ts";

const makeProjectionProviderRuntimeRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertProjectionProviderRuntimeRow = SqlSchema.void({
    Request: ProjectionProviderRuntime,
    execute: (row) =>
      sql`
        INSERT INTO projection_session_sessions (
          session_id,
          status,
          provider_name,
          provider_instance_id,
          runtime_mode,
          active_turn_id,
          last_error,
          updated_at
        )
        VALUES (
          ${row.sessionId},
          ${row.status},
          ${row.providerName},
          ${row.providerInstanceId},
          ${row.runtimeMode},
          ${row.activeTurnId},
          ${row.lastError},
          ${row.updatedAt}
        )
        ON CONFLICT (session_id)
        DO UPDATE SET
          status = excluded.status,
          provider_name = excluded.provider_name,
          provider_instance_id = excluded.provider_instance_id,
          runtime_mode = excluded.runtime_mode,
          active_turn_id = excluded.active_turn_id,
          last_error = excluded.last_error,
          updated_at = excluded.updated_at
      `,
  });

  const getProjectionProviderRuntimeRow = SqlSchema.findOneOption({
    Request: GetProjectionProviderRuntimeInput,
    Result: ProjectionProviderRuntime,
    execute: ({ sessionId }) =>
      sql`
        SELECT
          session_id AS "sessionId",
          status,
          provider_name AS "providerName",
          provider_instance_id AS "providerInstanceId",
          runtime_mode AS "runtimeMode",
          active_turn_id AS "activeTurnId",
          last_error AS "lastError",
          updated_at AS "updatedAt"
        FROM projection_session_sessions
        WHERE session_id = ${sessionId}
      `,
  });

  const deleteProjectionProviderRuntimeRow = SqlSchema.void({
    Request: DeleteProjectionProviderRuntimeInput,
    execute: ({ sessionId }) =>
      sql`
        DELETE FROM projection_session_sessions
        WHERE session_id = ${sessionId}
      `,
  });

  const upsert: ProjectionProviderRuntimeRepositoryShape["upsert"] = (row) =>
    upsertProjectionProviderRuntimeRow(row).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionProviderRuntimeRepository.upsert:query")),
    );

  const getBySessionId: ProjectionProviderRuntimeRepositoryShape["getBySessionId"] = (input) =>
    getProjectionProviderRuntimeRow(input).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionProviderRuntimeRepository.getBySessionId:query"),
      ),
    );

  const deleteBySessionId: ProjectionProviderRuntimeRepositoryShape["deleteBySessionId"] = (
    input,
  ) =>
    deleteProjectionProviderRuntimeRow(input).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionProviderRuntimeRepository.deleteBySessionId:query"),
      ),
    );

  return {
    upsert,
    getBySessionId,
    deleteBySessionId,
  } satisfies ProjectionProviderRuntimeRepositoryShape;
});

export const ProjectionProviderRuntimeRepositoryLive = Layer.effect(
  ProjectionProviderRuntimeRepository,
  makeProjectionProviderRuntimeRepository,
);
