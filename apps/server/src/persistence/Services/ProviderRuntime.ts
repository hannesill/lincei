/**
 * ProviderRuntimeRepository - Repository interface for provider runtime sessions.
 *
 * Owns persistence operations for provider runtime metadata and resume cursors.
 *
 * @module ProviderRuntimeRepository
 */
import {
  IsoDateTime,
  ProviderInstanceId,
  ProviderRuntimeStatus,
  RuntimeMode,
  SessionId,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

import type { ProviderRuntimeRepositoryError } from "../Errors.ts";

export const ProviderRuntime = Schema.Struct({
  sessionId: SessionId,
  providerName: Schema.String,
  /**
   * User-defined routing key for the configured provider instance that
   * owns this session. Nullable only at the storage/migration boundary:
   * rows persisted before the driver/instance split carry only
   * `providerName`. Repository consumers must materialize a concrete
   * instance id before routing.
   */
  providerInstanceId: Schema.NullOr(ProviderInstanceId),
  adapterKey: Schema.String,
  runtimeMode: RuntimeMode,
  status: ProviderRuntimeStatus,
  lastSeenAt: IsoDateTime,
  resumeCursor: Schema.NullOr(Schema.Unknown),
  runtimePayload: Schema.NullOr(Schema.Unknown),
});
export type ProviderRuntime = typeof ProviderRuntime.Type;

export const GetProviderRuntimeInput = Schema.Struct({ sessionId: SessionId });
export type GetProviderRuntimeInput = typeof GetProviderRuntimeInput.Type;

export const DeleteProviderRuntimeInput = Schema.Struct({ sessionId: SessionId });
export type DeleteProviderRuntimeInput = typeof DeleteProviderRuntimeInput.Type;

/**
 * ProviderRuntimeRepositoryShape - Service API for provider runtime records.
 */
export interface ProviderRuntimeRepositoryShape {
  /**
   * Insert or replace a provider runtime row.
   *
   * Upserts by canonical `sessionId`, including JSON payload/cursor fields.
   */
  readonly upsert: (
    runtime: ProviderRuntime,
  ) => Effect.Effect<void, ProviderRuntimeRepositoryError>;

  /**
   * Read provider runtime state by canonical session id.
   */
  readonly getBySessionId: (
    input: GetProviderRuntimeInput,
  ) => Effect.Effect<Option.Option<ProviderRuntime>, ProviderRuntimeRepositoryError>;

  /**
   * List all provider runtime rows.
   *
   * Returned in ascending last-seen order.
   */
  readonly list: () => Effect.Effect<
    ReadonlyArray<ProviderRuntime>,
    ProviderRuntimeRepositoryError
  >;

  /**
   * Delete provider runtime state by canonical session id.
   */
  readonly deleteBySessionId: (
    input: DeleteProviderRuntimeInput,
  ) => Effect.Effect<void, ProviderRuntimeRepositoryError>;
}

/**
 * ProviderRuntimeRepository - Service tag for provider runtime persistence.
 */
export class ProviderRuntimeRepository extends Context.Service<
  ProviderRuntimeRepository,
  ProviderRuntimeRepositoryShape
>()("t3/persistence/Services/ProviderRuntime/ProviderRuntimeRepository") {}
