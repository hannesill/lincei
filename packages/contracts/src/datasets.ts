import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  IsoDateTime,
  NonNegativeInt,
  TrimmedNonEmptyString,
  TrimmedString,
} from "./baseSchemas.ts";

export const DATASET_IDS = ["mimic-iv-demo", "mimic-iv", "mimic-iv-note", "eicu"] as const;
export const DatasetId = Schema.Literals(DATASET_IDS);
export type DatasetId = typeof DatasetId.Type;

export const DATASET_BACKEND_IDS = ["duckdb", "bigquery"] as const;
export const DatasetBackendId = Schema.Literals(DATASET_BACKEND_IDS);
export type DatasetBackendId = typeof DatasetBackendId.Type;

export const DatasetReadinessState = Schema.Literals([
  "missing_credentials",
  "not_initialized",
  "initializing",
  "ready",
  "failed",
]);
export type DatasetReadinessState = typeof DatasetReadinessState.Type;

export const DatasetOperationKind = Schema.Literals([
  "status",
  "initialize",
  "save_credentials",
  "clear_credentials",
]);
export type DatasetOperationKind = typeof DatasetOperationKind.Type;

export const DatasetErrorCode = Schema.Literals([
  "m4_unavailable",
  "m4_command_failed",
  "invalid_m4_status",
  "missing_credentials",
  "invalid_credentials",
  "bigquery_auth_failed",
  "dataset_initialization_failed",
  "dataset_operation_in_progress",
  "policy_denied",
  "settings_error",
  "secret_store_error",
  "unknown",
]);
export type DatasetErrorCode = typeof DatasetErrorCode.Type;

const DatasetErrorFields = {
  code: DatasetErrorCode,
  detail: TrimmedNonEmptyString,
  actionableMessage: Schema.optional(TrimmedNonEmptyString),
  command: Schema.optional(TrimmedNonEmptyString),
  exitCode: Schema.optional(Schema.Int),
  stderr: Schema.optional(TrimmedString),
};

export const DatasetErrorDetail = Schema.Struct(DatasetErrorFields);
export type DatasetErrorDetail = typeof DatasetErrorDetail.Type;

export class DatasetRpcError extends Schema.TaggedErrorClass<DatasetRpcError>()(
  "DatasetRpcError",
  DatasetErrorFields,
) {
  override get message(): string {
    return this.actionableMessage ?? this.detail;
  }
}

export const DatasetCredentialPresence = Schema.Struct({
  physioNet: Schema.Struct({
    stored: Schema.Boolean,
    username: Schema.optional(TrimmedNonEmptyString),
    updatedAt: Schema.optional(IsoDateTime),
  }),
  bigQuery: Schema.Struct({
    stored: Schema.Boolean,
    projectId: Schema.optional(TrimmedNonEmptyString),
    serviceAccountJsonStored: Schema.Boolean.pipe(
      Schema.withDecodingDefault(Effect.succeed(false)),
    ),
    applicationDefaultCredentials: Schema.Boolean.pipe(
      Schema.withDecodingDefault(Effect.succeed(false)),
    ),
    updatedAt: Schema.optional(IsoDateTime),
  }),
});
export type DatasetCredentialPresence = typeof DatasetCredentialPresence.Type;

export const DatasetRuntimeStatus = Schema.Struct({
  available: Schema.Boolean,
  command: TrimmedNonEmptyString,
  version: Schema.optional(TrimmedNonEmptyString),
  workspacePath: Schema.optional(TrimmedNonEmptyString),
  checkedAt: IsoDateTime,
  error: Schema.optional(DatasetErrorDetail),
});
export type DatasetRuntimeStatus = typeof DatasetRuntimeStatus.Type;

export const DatasetInitOperationState = Schema.Struct({
  datasetId: DatasetId,
  backendId: DatasetBackendId,
  state: Schema.Literals(["queued", "running", "succeeded", "failed"]),
  startedAt: IsoDateTime,
  finishedAt: Schema.optional(IsoDateTime),
  error: Schema.optional(DatasetErrorDetail),
});
export type DatasetInitOperationState = typeof DatasetInitOperationState.Type;

export const DatasetTableReadiness = Schema.Struct({
  name: TrimmedNonEmptyString,
  ready: Schema.Boolean,
  rowCount: Schema.optional(NonNegativeInt),
});
export type DatasetTableReadiness = typeof DatasetTableReadiness.Type;

export const DatasetDerivedTableReadiness = Schema.Struct({
  supported: Schema.Boolean,
  ready: Schema.Boolean,
  total: Schema.optional(NonNegativeInt),
  materialized: Schema.optional(NonNegativeInt),
  backendAvailable: Schema.optional(Schema.Boolean),
});
export type DatasetDerivedTableReadiness = typeof DatasetDerivedTableReadiness.Type;

export const DatasetStatusSnapshot = Schema.Struct({
  datasetId: DatasetId,
  backendId: DatasetBackendId,
  readiness: DatasetReadinessState,
  initialized: Schema.Boolean,
  bundled: Schema.optionalKey(Schema.Boolean).pipe(
    Schema.withDecodingDefaultType(Effect.succeed(false)),
  ),
  selected: Schema.optional(Schema.Boolean),
  active: Schema.optional(Schema.Boolean),
  path: Schema.optional(TrimmedNonEmptyString),
  tables: Schema.Array(DatasetTableReadiness).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  derivedTables: Schema.optional(DatasetDerivedTableReadiness),
  lastCheckedAt: IsoDateTime,
  operation: Schema.optional(DatasetInitOperationState),
  error: Schema.optional(DatasetErrorDetail),
});
export type DatasetStatusSnapshot = typeof DatasetStatusSnapshot.Type;

export const DatasetAppReadiness = Schema.Struct({
  selectedDatasetId: Schema.optional(DatasetId),
  selectedBackendId: Schema.optional(DatasetBackendId),
  activeDatasetId: Schema.optional(DatasetId),
  activeBackendId: Schema.optional(DatasetBackendId),
  clinicalDataReady: Schema.Boolean,
  readiness: DatasetReadinessState,
  lastCheckedAt: IsoDateTime,
  error: Schema.optional(DatasetErrorDetail),
});
export type DatasetAppReadiness = typeof DatasetAppReadiness.Type;

export const DatasetStatusResult = Schema.Struct({
  runtime: DatasetRuntimeStatus,
  credentials: DatasetCredentialPresence,
  datasets: Schema.Array(DatasetStatusSnapshot),
  appReadiness: DatasetAppReadiness,
});
export type DatasetStatusResult = typeof DatasetStatusResult.Type;

export const DatasetSettings = Schema.Struct({
  workspacePath: TrimmedString.pipe(Schema.withDecodingDefault(Effect.succeed(""))),
  preferredBackendId: DatasetBackendId.pipe(Schema.withDecodingDefault(Effect.succeed("duckdb"))),
  m4Command: TrimmedString.pipe(Schema.withDecodingDefault(Effect.succeed(""))),
});
export type DatasetSettings = typeof DatasetSettings.Type;

export const DatasetSettingsPatch = Schema.Struct({
  workspacePath: Schema.optionalKey(TrimmedString),
  preferredBackendId: Schema.optionalKey(DatasetBackendId),
  m4Command: Schema.optionalKey(TrimmedString),
});
export type DatasetSettingsPatch = typeof DatasetSettingsPatch.Type;

export const DatasetGetStatusInput = Schema.Struct({});
export type DatasetGetStatusInput = typeof DatasetGetStatusInput.Type;

export const DatasetSavePhysioNetCredentialsInput = Schema.Struct({
  username: TrimmedNonEmptyString,
  password: TrimmedNonEmptyString,
});
export type DatasetSavePhysioNetCredentialsInput = typeof DatasetSavePhysioNetCredentialsInput.Type;

export const DatasetSaveBigQueryCredentialsInput = Schema.Struct({
  projectId: TrimmedNonEmptyString,
  serviceAccountJson: Schema.optional(TrimmedNonEmptyString),
  useApplicationDefaultCredentials: Schema.Boolean.pipe(
    Schema.withDecodingDefault(Effect.succeed(false)),
  ),
});
export type DatasetSaveBigQueryCredentialsInput = typeof DatasetSaveBigQueryCredentialsInput.Type;

export const DatasetInitializeInput = Schema.Struct({
  datasetId: DatasetId,
  backendId: Schema.optional(DatasetBackendId),
});
export type DatasetInitializeInput = typeof DatasetInitializeInput.Type;

export const DatasetCredentialKind = Schema.Literals(["physionet", "bigquery", "all"]);
export type DatasetCredentialKind = typeof DatasetCredentialKind.Type;

export const DatasetClearCredentialsInput = Schema.Struct({
  credentialKind: DatasetCredentialKind,
});
export type DatasetClearCredentialsInput = typeof DatasetClearCredentialsInput.Type;

export const DatasetCredentialsResult = Schema.Struct({
  credentials: DatasetCredentialPresence,
});
export type DatasetCredentialsResult = typeof DatasetCredentialsResult.Type;
