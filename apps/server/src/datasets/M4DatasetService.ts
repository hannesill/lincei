import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
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
  type DatasetInitOperationState,
  type DatasetInitializeInput,
  type DatasetSaveBigQueryCredentialsInput,
  type DatasetSavePhysioNetCredentialsInput,
  type DatasetStatusSnapshot,
  type DatasetStatusResult,
} from "@t3tools/contracts";

import { SecretStoreError, ServerSecretStore } from "../auth/Services/ServerSecretStore.ts";
import { ServerConfig } from "../config.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import {
  discoverBundledMimicDemoAsset,
  markBundledMimicDemoFromSentinel,
  seedBundledMimicDemo,
} from "./bundledMimicDemo.ts";
import { M4Cli } from "./M4Cli.ts";
import { makeDatasetWorkspacePathResolver } from "./workspace.ts";

const PHYSIONET_SECRET = "datasets-physionet-credentials";
const BIGQUERY_SECRET = "datasets-bigquery-credentials";
const DERIVED_TABLE_DATASETS = new Set<DatasetId>(["mimic-iv"]);

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

const BigQueryServiceAccountJson = Schema.fromJsonString(
  Schema.Record(Schema.String, Schema.Unknown),
);

const decodePhysioNetSecret = Schema.decodeUnknownEffect(PhysioNetSecret);
const decodeBigQuerySecret = Schema.decodeUnknownEffect(BigQuerySecret);
const decodeBigQueryServiceAccountJson = Schema.decodeUnknownEffect(BigQueryServiceAccountJson);

export interface M4DatasetServiceShape {
  readonly getStatus: (input?: {
    readonly datasetId?: DatasetId | undefined;
    readonly backendId?: DatasetBackendId | undefined;
  }) => Effect.Effect<DatasetStatusResult, DatasetRpcError>;
  readonly savePhysioNetCredentials: (
    input: DatasetSavePhysioNetCredentialsInput,
  ) => Effect.Effect<DatasetCredentialsResult, DatasetRpcError>;
  readonly saveBigQueryCredentials: (
    input: DatasetSaveBigQueryCredentialsInput,
  ) => Effect.Effect<DatasetCredentialsResult, DatasetRpcError>;
  readonly initialize: (
    input: DatasetInitializeInput,
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
    detail: "BigQuery credentials must be saved before configuring the BigQuery backend.",
    actionableMessage:
      "Save a BigQuery project ID with service-account JSON or application default credentials.",
  });
}

function missingPhysioNetCredentials(datasetId: DatasetId): DatasetRpcError {
  return new DatasetRpcError({
    code: "missing_credentials",
    detail: `PhysioNet credentials must be saved before downloading ${datasetId}.`,
    actionableMessage: "Save PhysioNet credentials before initializing this dataset locally.",
  });
}

function invalidBigQueryCredentials(detail: string): DatasetRpcError {
  return new DatasetRpcError({
    code: "invalid_credentials",
    detail,
    actionableMessage:
      "Save a BigQuery project ID with valid service-account JSON or enable application default credentials.",
  });
}

function bigQueryCredentialFileError(error: unknown): DatasetRpcError {
  const detail = error instanceof Error ? error.message : String(error);
  return new DatasetRpcError({
    code: "secret_store_error",
    detail,
    actionableMessage: "Lincei could not prepare BigQuery credentials for M4.",
  });
}

function physioNetCredentialFileError(error: unknown): DatasetRpcError {
  const detail = error instanceof Error ? error.message : String(error);
  return new DatasetRpcError({
    code: "secret_store_error",
    detail,
    actionableMessage: "Lincei could not prepare PhysioNet credentials for M4.",
  });
}

function operationInProgress(datasetId: DatasetId, backendId: DatasetBackendId): DatasetRpcError {
  return new DatasetRpcError({
    code: "dataset_operation_in_progress",
    detail: `Dataset initialization is already running for ${datasetId}:${backendId}.`,
    actionableMessage: "Wait for the current dataset initialization to finish.",
  });
}

function operationKey(datasetId: DatasetId, backendId: DatasetBackendId): string {
  return `${datasetId}:${backendId}`;
}

function credentialPresenceFromSecrets(input: {
  readonly physioNet: PhysioNetSecret | null;
  readonly bigQuery: BigQuerySecret | null;
}): DatasetCredentialPresence {
  return {
    physioNet:
      input.physioNet === null
        ? { stored: false }
        : {
            stored: true,
            username: input.physioNet.username,
            updatedAt: input.physioNet.updatedAt,
          },
    bigQuery:
      input.bigQuery === null
        ? {
            stored: false,
            serviceAccountJsonStored: false,
            applicationDefaultCredentials: false,
          }
        : {
            stored: true,
            projectId: input.bigQuery.projectId,
            serviceAccountJsonStored: input.bigQuery.serviceAccountJson !== undefined,
            applicationDefaultCredentials: input.bigQuery.useApplicationDefaultCredentials,
            updatedAt: input.bigQuery.updatedAt,
          },
  };
}

export const makeM4DatasetService = Effect.gen(function* () {
  const config = yield* ServerConfig;
  const serverSettings = yield* ServerSettingsService;
  const secretStore = yield* ServerSecretStore;
  const m4Cli = yield* M4Cli;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const resolveDatasetWorkspacePath = makeDatasetWorkspacePathResolver({
    config,
    fileSystem,
    path,
  });
  const activeOperations = yield* Ref.make<ReadonlyMap<string, DatasetInitOperationState>>(
    new Map(),
  );

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

  const readCredentialSecrets = Effect.all({
    physioNet: readPhysioNetSecret,
    bigQuery: readBigQuerySecret,
  });

  const readCredentialPresence: Effect.Effect<DatasetCredentialPresence, DatasetRpcError> =
    readCredentialSecrets.pipe(Effect.map(credentialPresenceFromSecrets));

  const workspacePath = serverSettings.getSettings.pipe(
    Effect.mapError(settingsError),
    Effect.flatMap((settings) => resolveDatasetWorkspacePath(settings.datasets.workspacePath)),
  );

  const provideBundledDatasetServices = <A, E>(
    effect: Effect.Effect<A, E, FileSystem.FileSystem | Path.Path>,
  ) =>
    effect.pipe(
      Effect.provideService(FileSystem.FileSystem, fileSystem),
      Effect.provideService(Path.Path, path),
    );
  const bundledMimicDemoAsset = provideBundledDatasetServices(
    discoverBundledMimicDemoAsset(config.bundledDatasetsDir),
  );
  const seedBundledMimicDemoWithServices = (input: Parameters<typeof seedBundledMimicDemo>[0]) =>
    provideBundledDatasetServices(seedBundledMimicDemo(input));
  const markBundledMimicDemoWithServices = (cwd: string, status: DatasetStatusResult) =>
    provideBundledDatasetServices(markBundledMimicDemoFromSentinel(cwd, status));

  const mergeActiveOperations = (
    status: DatasetStatusResult,
    operations: ReadonlyMap<string, DatasetInitOperationState>,
  ): DatasetStatusResult => {
    if (operations.size === 0) {
      return status;
    }

    const datasets = status.datasets.map((dataset): DatasetStatusSnapshot => {
      const operation = operations.get(operationKey(dataset.datasetId, dataset.backendId));
      if (!operation || (operation.state !== "queued" && operation.state !== "running")) {
        return dataset;
      }
      return {
        ...dataset,
        readiness: "initializing",
        operation,
        error: undefined,
      };
    });
    const selectedDataset = datasets.find((dataset) => dataset.selected === true);
    const appOperation =
      selectedDataset && selectedDataset.operation
        ? selectedDataset.operation
        : status.appReadiness.selectedDatasetId && status.appReadiness.selectedBackendId
          ? operations.get(
              operationKey(
                status.appReadiness.selectedDatasetId,
                status.appReadiness.selectedBackendId,
              ),
            )
          : undefined;

    return {
      ...status,
      datasets,
      appReadiness:
        appOperation && (appOperation.state === "queued" || appOperation.state === "running")
          ? {
              ...status.appReadiness,
              readiness: "initializing",
              clinicalDataReady: false,
              error: undefined,
            }
          : status.appReadiness,
    };
  };

  const getStatus: M4DatasetServiceShape["getStatus"] = (input) =>
    Effect.gen(function* () {
      const [cwd, secrets] = yield* Effect.all([workspacePath, readCredentialSecrets]);
      const credentials = credentialPresenceFromSecrets(secrets);
      return yield* withBigQueryEnvironment(secrets.bigQuery, (env) =>
        Effect.gen(function* () {
          const [initialStatus, operations] = yield* Effect.all([
            m4Cli.status({
              cwd,
              credentials,
              datasetId: input?.datasetId,
              backendId: input?.backendId,
              env,
            }),
            Ref.get(activeOperations),
          ]);
          const asset = input?.backendId === "bigquery" ? null : yield* bundledMimicDemoAsset;
          const seeded =
            asset === null
              ? false
              : yield* seedBundledMimicDemoWithServices({
                  workspacePath: cwd,
                  asset,
                  currentStatus: initialStatus,
                });
          const status = seeded
            ? yield* m4Cli.status({
                cwd,
                credentials,
                datasetId: input?.datasetId,
                backendId: input?.backendId,
                env,
              })
            : initialStatus;
          const markedStatus = yield* markBundledMimicDemoWithServices(cwd, status);
          return mergeActiveOperations(markedStatus, operations);
        }),
      );
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
      if (!input.useApplicationDefaultCredentials && input.serviceAccountJson === undefined) {
        return yield* invalidBigQueryCredentials(
          "BigQuery credentials require service-account JSON or application default credentials.",
        );
      }
      if (!input.useApplicationDefaultCredentials && input.serviceAccountJson !== undefined) {
        yield* decodeBigQueryServiceAccountJson(input.serviceAccountJson).pipe(
          Effect.mapError(() =>
            invalidBigQueryCredentials("BigQuery service-account JSON is invalid."),
          ),
        );
      }
      const secret: BigQuerySecret = {
        projectId: input.projectId,
        ...(!input.useApplicationDefaultCredentials && input.serviceAccountJson
          ? { serviceAccountJson: input.serviceAccountJson }
          : {}),
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
    const key = operationKey(datasetId, backendId);
    return Effect.gen(function* () {
      const startedAt = yield* currentIso;
      const operation: DatasetInitOperationState = {
        datasetId,
        backendId,
        state: "running",
        startedAt,
      };
      const acquired = yield* Ref.modify(activeOperations, (operations) => {
        if (operations.has(key)) {
          return [false, operations] as const;
        }
        return [true, new Map([...operations, [key, operation]])] as const;
      });
      if (!acquired) {
        return yield* operationInProgress(datasetId, backendId);
      }
      return yield* effect.pipe(
        Effect.ensuring(
          Ref.update(activeOperations, (operations) => {
            const next = new Map(operations);
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

  const withBigQueryEnvironment = <A>(
    secret: BigQuerySecret | null,
    effect: (env: NodeJS.ProcessEnv | undefined) => Effect.Effect<A, DatasetRpcError>,
  ): Effect.Effect<A, DatasetRpcError> =>
    Effect.scoped(
      Effect.gen(function* () {
        if (!secret?.serviceAccountJson) {
          return yield* effect(undefined);
        }
        const credentialFilePath = yield* fileSystem
          .makeTempFileScoped({
            prefix: `lincei-bigquery-${process.pid}-`,
            suffix: ".json",
          })
          .pipe(
            Effect.tap((filePath) =>
              fileSystem.writeFileString(filePath, secret.serviceAccountJson!),
            ),
            Effect.mapError(bigQueryCredentialFileError),
          );
        return yield* effect({ GOOGLE_APPLICATION_CREDENTIALS: credentialFilePath });
      }),
    );

  const withPhysioNetCredentialsFile = <A>(
    secret: PhysioNetSecret | null,
    effect: (credentialsFilePath: string | undefined) => Effect.Effect<A, DatasetRpcError>,
  ): Effect.Effect<A, DatasetRpcError> =>
    Effect.scoped(
      Effect.gen(function* () {
        if (!secret) {
          return yield* effect(undefined);
        }
        const credentialsFilePath = yield* fileSystem
          .makeTempFileScoped({
            prefix: `lincei-physionet-${process.pid}-`,
            suffix: ".json",
          })
          .pipe(
            Effect.tap((filePath) =>
              fileSystem.writeFileString(
                filePath,
                JSON.stringify({
                  username: secret.username,
                  password: secret.password,
                }),
              ),
            ),
            Effect.mapError(physioNetCredentialFileError),
          );
        return yield* effect(credentialsFilePath);
      }),
    );

  const initialize: M4DatasetServiceShape["initialize"] = (input) =>
    Effect.gen(function* () {
      const settings = yield* serverSettings.getSettings.pipe(Effect.mapError(settingsError));
      const backendId = input.backendId ?? settings.datasets.preferredBackendId;
      const cwd = yield* resolveDatasetWorkspacePath(settings.datasets.workspacePath);

      return yield* withInitializationKey(
        input.datasetId,
        backendId,
        Effect.gen(function* () {
          if (backendId === "bigquery") {
            const secret = yield* requireBigQuerySecret;
            return yield* withBigQueryEnvironment(secret, (env) =>
              Effect.gen(function* () {
                yield* m4Cli.backend({ cwd, backendId, projectId: secret.projectId, env });
                const credentials = yield* readCredentialPresence;
                return yield* m4Cli.status({
                  cwd,
                  credentials,
                  datasetId: input.datasetId,
                  backendId,
                  env,
                });
              }),
            );
          } else {
            const asset =
              input.datasetId === "mimic-iv-demo" && backendId === "duckdb"
                ? yield* bundledMimicDemoAsset
                : null;
            if (asset !== null) {
              const credentials = yield* readCredentialPresence;
              const currentStatus = yield* m4Cli.status({
                cwd,
                credentials,
                datasetId: input.datasetId,
                backendId,
              });
              yield* seedBundledMimicDemoWithServices({
                workspacePath: cwd,
                asset,
                currentStatus,
              });
              const seededStatus = yield* m4Cli.status({
                cwd,
                credentials,
                datasetId: input.datasetId,
                backendId,
              });
              return yield* markBundledMimicDemoWithServices(cwd, seededStatus);
            }
            const physioNetSecret = yield* readPhysioNetSecret;
            if (input.datasetId !== "mimic-iv-demo" && physioNetSecret === null) {
              return yield* missingPhysioNetCredentials(input.datasetId);
            }
            yield* withPhysioNetCredentialsFile(physioNetSecret, (physioNetCredentialsFile) =>
              Effect.gen(function* () {
                yield* m4Cli.initialize({
                  cwd,
                  datasetId: input.datasetId,
                  download: input.datasetId !== "mimic-iv-demo",
                  physioNetCredentialsFile,
                });
                if (DERIVED_TABLE_DATASETS.has(input.datasetId)) {
                  yield* m4Cli.initializeDerived({
                    cwd,
                    datasetId: input.datasetId,
                  });
                }
              }),
            );
          }

          const credentials = yield* readCredentialPresence;
          return yield* m4Cli.status({
            cwd,
            credentials,
            datasetId: input.datasetId,
            backendId,
          });
        }),
      );
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
    clearCredentials,
  });
});

export const layer = Layer.effect(M4DatasetService, makeM4DatasetService);
