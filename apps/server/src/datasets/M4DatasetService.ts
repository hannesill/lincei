import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";

import {
  DatasetRpcError,
  ServerSettingsError,
  type DatasetBackendId,
  type DatasetClearCredentialsInput,
  type DatasetCredentialPresence,
  type DatasetCredentialsResult,
  type DatasetId,
  type DatasetInitializeInput,
  type DatasetSaveBigQueryCredentialsInput,
  type DatasetSavePhysioNetCredentialsInput,
  type DatasetSetActiveDatasetInput,
  type DatasetStatusResult,
} from "@t3tools/contracts";

import { SecretStoreError, ServerSecretStore } from "../auth/Services/ServerSecretStore.ts";
import { ServerConfig } from "../config.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import { M4Cli } from "./M4Cli.ts";

const PHYSIONET_SECRET = "datasets-physionet-credentials";
const BIGQUERY_SECRET = "datasets-bigquery-credentials";

const PhysioNetSecret = Schema.Struct({
  username: Schema.String,
  password: Schema.String,
  updatedAt: Schema.String,
});
type PhysioNetSecret = typeof PhysioNetSecret.Type;

const BigQuerySecret = Schema.Struct({
  projectId: Schema.String,
  serviceAccountJson: Schema.optional(Schema.String),
  useApplicationDefaultCredentials: Schema.Boolean,
  updatedAt: Schema.String,
});
type BigQuerySecret = typeof BigQuerySecret.Type;

const decodePhysioNetSecret = Schema.decodeUnknownEffect(PhysioNetSecret);
const decodeBigQuerySecret = Schema.decodeUnknownEffect(BigQuerySecret);

export interface M4DatasetServiceShape {
  readonly getStatus: () => Effect.Effect<DatasetStatusResult, DatasetRpcError>;
  readonly savePhysioNetCredentials: (
    input: DatasetSavePhysioNetCredentialsInput,
  ) => Effect.Effect<DatasetCredentialsResult, DatasetRpcError>;
  readonly saveBigQueryCredentials: (
    input: DatasetSaveBigQueryCredentialsInput,
  ) => Effect.Effect<DatasetCredentialsResult, DatasetRpcError>;
  readonly initialize: (
    input: DatasetInitializeInput,
  ) => Effect.Effect<DatasetStatusResult, DatasetRpcError>;
  readonly setActiveDataset: (
    input: DatasetSetActiveDatasetInput,
  ) => Effect.Effect<DatasetStatusResult, DatasetRpcError>;
  readonly clearCredentials: (
    input: DatasetClearCredentialsInput,
  ) => Effect.Effect<DatasetCredentialsResult, DatasetRpcError>;
}

export class M4DatasetService extends Context.Service<M4DatasetService, M4DatasetServiceShape>()(
  "t3/datasets/M4DatasetService",
) {}

function encodeSecret(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

function decodeSecret(bytes: Uint8Array): unknown {
  return JSON.parse(new TextDecoder().decode(bytes));
}

const currentIso = Effect.map(DateTime.now, DateTime.formatIso);

function settingsError(error: ServerSettingsError): DatasetRpcError {
  return new DatasetRpcError({
    code: "settings_error",
    detail: error.message,
    actionableMessage: "Lincei could not persist dataset settings.",
  });
}

function secretStoreError(error: SecretStoreError | unknown): DatasetRpcError {
  const detail =
    error instanceof SecretStoreError
      ? error.message
      : error instanceof Error
        ? error.message
        : String(error);
  return new DatasetRpcError({
    code: "secret_store_error",
    detail,
    actionableMessage: "Lincei could not read or write dataset credentials.",
  });
}

function missingBigQueryCredentials(): DatasetRpcError {
  return new DatasetRpcError({
    code: "missing_credentials",
    detail: "BigQuery credentials must be saved before activating the BigQuery backend.",
    actionableMessage: "Save a BigQuery project ID before using BigQuery datasets.",
  });
}

function operationInProgress(datasetId: DatasetId, backendId: DatasetBackendId): DatasetRpcError {
  return new DatasetRpcError({
    code: "dataset_operation_in_progress",
    detail: `Dataset initialization is already running for ${datasetId}:${backendId}.`,
    actionableMessage: "Wait for the current dataset initialization to finish.",
  });
}

export const makeM4DatasetService = Effect.gen(function* () {
  const config = yield* ServerConfig;
  const serverSettings = yield* ServerSettingsService;
  const secretStore = yield* ServerSecretStore;
  const m4Cli = yield* M4Cli;
  const initializingKeys = yield* Ref.make<ReadonlySet<string>>(new Set());

  const readPhysioNetSecret = secretStore.get(PHYSIONET_SECRET).pipe(
    Effect.mapError(secretStoreError),
    Effect.flatMap((bytes) =>
      bytes === null
        ? Effect.succeed(null)
        : Effect.try({
            try: () => decodeSecret(bytes),
            catch: secretStoreError,
          }).pipe(
            Effect.flatMap((raw) =>
              decodePhysioNetSecret(raw).pipe(Effect.mapError(secretStoreError)),
            ),
          ),
    ),
  );

  const readBigQuerySecret = secretStore.get(BIGQUERY_SECRET).pipe(
    Effect.mapError(secretStoreError),
    Effect.flatMap((bytes) =>
      bytes === null
        ? Effect.succeed(null)
        : Effect.try({
            try: () => decodeSecret(bytes),
            catch: secretStoreError,
          }).pipe(
            Effect.flatMap((raw) =>
              decodeBigQuerySecret(raw).pipe(Effect.mapError(secretStoreError)),
            ),
          ),
    ),
  );

  const readCredentialPresence: Effect.Effect<DatasetCredentialPresence, DatasetRpcError> =
    Effect.all({
      physioNet: readPhysioNetSecret,
      bigQuery: readBigQuerySecret,
    }).pipe(
      Effect.map(
        ({ physioNet, bigQuery }): DatasetCredentialPresence => ({
          physioNet:
            physioNet === null
              ? { stored: false }
              : {
                  stored: true,
                  username: physioNet.username,
                  updatedAt: physioNet.updatedAt,
                },
          bigQuery:
            bigQuery === null
              ? {
                  stored: false,
                  serviceAccountJsonStored: false,
                  applicationDefaultCredentials: false,
                }
              : {
                  stored: true,
                  projectId: bigQuery.projectId,
                  serviceAccountJsonStored: bigQuery.serviceAccountJson !== undefined,
                  applicationDefaultCredentials: bigQuery.useApplicationDefaultCredentials,
                  updatedAt: bigQuery.updatedAt,
                },
        }),
      ),
    );

  const workspacePath = serverSettings.getSettings.pipe(
    Effect.map((settings) => settings.datasets.workspacePath || config.cwd),
    Effect.mapError(settingsError),
  );

  const getStatus: M4DatasetServiceShape["getStatus"] = () =>
    Effect.gen(function* () {
      const [cwd, credentials] = yield* Effect.all([workspacePath, readCredentialPresence]);
      return yield* m4Cli.status({ cwd, credentials });
    });

  const savePhysioNetCredentials: M4DatasetServiceShape["savePhysioNetCredentials"] = (input) =>
    Effect.gen(function* () {
      const secret: PhysioNetSecret = {
        username: input.username,
        password: input.password,
        updatedAt: yield* currentIso,
      };
      yield* secretStore
        .set(PHYSIONET_SECRET, encodeSecret(secret))
        .pipe(Effect.mapError(secretStoreError));
      return { credentials: yield* readCredentialPresence };
    });

  const saveBigQueryCredentials: M4DatasetServiceShape["saveBigQueryCredentials"] = (input) =>
    Effect.gen(function* () {
      const secret: BigQuerySecret = {
        projectId: input.projectId,
        ...(input.serviceAccountJson ? { serviceAccountJson: input.serviceAccountJson } : {}),
        useApplicationDefaultCredentials: input.useApplicationDefaultCredentials,
        updatedAt: yield* currentIso,
      };
      yield* secretStore
        .set(BIGQUERY_SECRET, encodeSecret(secret))
        .pipe(Effect.mapError(secretStoreError));
      return { credentials: yield* readCredentialPresence };
    });

  const withInitializationKey = <A>(
    datasetId: DatasetId,
    backendId: DatasetBackendId,
    effect: Effect.Effect<A, DatasetRpcError>,
  ) => {
    const key = `${datasetId}:${backendId}`;
    return Effect.gen(function* () {
      const acquired = yield* Ref.modify(initializingKeys, (keys) => {
        if (keys.has(key)) {
          return [false, keys] as const;
        }
        return [true, new Set([...keys, key])] as const;
      });
      if (!acquired) {
        return yield* operationInProgress(datasetId, backendId);
      }
      return yield* effect.pipe(
        Effect.ensuring(
          Ref.update(initializingKeys, (keys) => {
            const next = new Set(keys);
            next.delete(key);
            return next;
          }),
        ),
      );
    });
  };

  const requireBigQuerySecret = readBigQuerySecret.pipe(
    Effect.flatMap((secret) =>
      secret ? Effect.succeed(secret) : Effect.fail(missingBigQueryCredentials()),
    ),
  );

  const persistDatasetSelection = (input: {
    readonly datasetId: DatasetId;
    readonly backendId: DatasetBackendId;
  }) =>
    serverSettings
      .updateSettings({
        datasets: {
          activeDatasetId: input.datasetId,
          preferredBackendId: input.backendId,
        },
      })
      .pipe(Effect.mapError(settingsError), Effect.asVoid);

  const initialize: M4DatasetServiceShape["initialize"] = (input) =>
    Effect.gen(function* () {
      const settings = yield* serverSettings.getSettings.pipe(Effect.mapError(settingsError));
      const backendId = input.backendId ?? settings.datasets.preferredBackendId;
      const cwd = settings.datasets.workspacePath || config.cwd;

      return yield* withInitializationKey(
        input.datasetId,
        backendId,
        Effect.gen(function* () {
          if (backendId === "bigquery") {
            const secret = yield* requireBigQuerySecret;
            yield* m4Cli.backend({ cwd, backendId, projectId: secret.projectId });
            yield* m4Cli.use({ cwd, datasetId: input.datasetId });
          } else {
            yield* m4Cli.initialize({ cwd, datasetId: input.datasetId });
          }

          yield* persistDatasetSelection({ datasetId: input.datasetId, backendId });
          const credentials = yield* readCredentialPresence;
          return yield* m4Cli.status({ cwd, credentials });
        }),
      );
    });

  const setActiveDataset: M4DatasetServiceShape["setActiveDataset"] = (input) =>
    Effect.gen(function* () {
      const cwd = yield* workspacePath;
      const projectId =
        input.backendId === "bigquery" ? (yield* requireBigQuerySecret).projectId : undefined;
      yield* m4Cli.backend({ cwd, backendId: input.backendId, projectId });
      yield* m4Cli.use({ cwd, datasetId: input.datasetId });
      yield* persistDatasetSelection(input);
      const credentials = yield* readCredentialPresence;
      return yield* m4Cli.status({ cwd, credentials });
    });

  const clearCredentials: M4DatasetServiceShape["clearCredentials"] = (input) =>
    Effect.gen(function* () {
      if (input.credentialKind === "physionet" || input.credentialKind === "all") {
        yield* secretStore.remove(PHYSIONET_SECRET).pipe(Effect.mapError(secretStoreError));
      }
      if (input.credentialKind === "bigquery" || input.credentialKind === "all") {
        yield* secretStore.remove(BIGQUERY_SECRET).pipe(Effect.mapError(secretStoreError));
      }
      return { credentials: yield* readCredentialPresence };
    });

  return M4DatasetService.of({
    getStatus,
    savePhysioNetCredentials,
    saveBigQueryCredentials,
    initialize,
    setActiveDataset,
    clearCredentials,
  });
});

export const layer = Layer.effect(M4DatasetService, makeM4DatasetService);
