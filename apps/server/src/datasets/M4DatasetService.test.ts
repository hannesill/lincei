import * as NodeOS from "node:os";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, beforeEach, describe, expect, it, vi } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Result from "effect/Result";

import type {
  DatasetCredentialPresence,
  DatasetStatusResult,
  DatasetStatusSnapshot,
} from "@t3tools/contracts";

import { ServerSecretStoreLive } from "../auth/Layers/ServerSecretStore.ts";
import { ServerConfig } from "../config.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import { M4Cli, type M4CliShape } from "./M4Cli.ts";
import { M4DatasetService } from "./M4DatasetService.ts";
import * as M4DatasetServiceLayer from "./M4DatasetService.ts";

const commandResult = {
  version: 1,
  ok: true,
  command: "ok",
  warnings: [],
};

const emptyCredentials: DatasetCredentialPresence = {
  physioNet: { stored: false },
  bigQuery: {
    stored: false,
    serviceAccountJsonStored: false,
    applicationDefaultCredentials: false,
  },
};

function statusResult(
  credentials: DatasetCredentialPresence,
  dataset: DatasetStatusSnapshot = {
    datasetId: "mimic-iv-demo",
    backendId: "duckdb",
    readiness: "ready",
    initialized: true,
    selected: true,
    tables: [],
    lastCheckedAt: "2026-05-28T10:00:00.000Z",
  },
): DatasetStatusResult {
  return {
    runtime: {
      available: true,
      command: "uvx --from m4-infra m4",
      checkedAt: "2026-05-28T10:00:00.000Z",
    },
    credentials,
    datasets: [dataset],
    appReadiness: {
      selectedDatasetId: dataset.datasetId,
      selectedBackendId: dataset.backendId,
      clinicalDataReady: true,
      readiness: "ready",
      lastCheckedAt: "2026-05-28T10:00:00.000Z",
    },
  };
}

const mockStatus = vi.fn<M4CliShape["status"]>();
const mockInitialize = vi.fn<M4CliShape["initialize"]>();
const mockInitializeDerived = vi.fn<M4CliShape["initializeDerived"]>();
const mockBackend = vi.fn<M4CliShape["backend"]>();
const mockExec = vi.fn<M4CliShape["exec"]>();
const mockJson = vi.fn<M4CliShape["json"]>();

const makeLayer = (
  settingsOverrides: Parameters<typeof ServerSettingsService.layerTest>[0] = {
    datasets: { workspacePath: process.cwd() },
  },
  baseDirOrPrefix: Parameters<typeof ServerConfig.layerTest>[1] = {
    prefix: "t3-m4-dataset-service-test-",
  },
) =>
  M4DatasetServiceLayer.layer.pipe(
    Layer.provide(
      Layer.succeed(
        M4Cli,
        M4Cli.of({
          defaultCommand: "uvx --from m4-infra m4",
          resolveCommand: (configuredCommand) => ({
            command: configuredCommand || "uvx",
            prefixArgs: configuredCommand ? [] : ["--from", "m4-infra", "m4"],
          }),
          exec: mockExec,
          json: mockJson,
          status: mockStatus,
          initialize: mockInitialize,
          initializeDerived: mockInitializeDerived,
          backend: mockBackend,
        }),
      ),
    ),
    Layer.provide(ServerSecretStoreLive),
    Layer.provide(ServerSettingsService.layerTest(settingsOverrides)),
    Layer.provide(ServerConfig.layerTest(process.cwd(), baseDirOrPrefix)),
  );

const failingPhysioNetCredentialFileLayer = Layer.effect(
  FileSystem.FileSystem,
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    return {
      ...fileSystem,
      writeFileString: ((filePath: string, contents: string, options?: unknown) =>
        filePath.includes("lincei-physionet-")
          ? Effect.fail("physionet temp denied")
          : fileSystem.writeFileString(
              filePath,
              contents,
              options as never,
            )) as typeof fileSystem.writeFileString,
    } satisfies FileSystem.FileSystem;
  }),
).pipe(Layer.provide(NodeServices.layer));

beforeEach(() => {
  mockStatus.mockReset();
  mockInitialize.mockReset();
  mockInitializeDerived.mockReset();
  mockBackend.mockReset();
  mockExec.mockReset();
  mockJson.mockReset();
  mockStatus.mockImplementation(({ credentials }) => Effect.succeed(statusResult(credentials)));
  mockInitialize.mockReturnValue(Effect.succeed(commandResult));
  mockInitializeDerived.mockReturnValue(Effect.succeed(commandResult));
  mockBackend.mockReturnValue(Effect.succeed(commandResult));
});

describe("M4DatasetService", () => {
  it.layer(NodeServices.layer)("credentials", (it) => {
    it.effect("saves and clears credentials without returning secret values", () =>
      Effect.gen(function* () {
        const service = yield* M4DatasetService;

        const physioNet = yield* service.savePhysioNetCredentials({
          username: "researcher",
          password: "secret-password",
        });
        const bigQuery = yield* service.saveBigQueryCredentials({
          projectId: "clinical-project",
          serviceAccountJson: '{"private_key":"secret"}',
          useApplicationDefaultCredentials: false,
        });

        expect(physioNet.credentials.physioNet).toEqual(
          expect.objectContaining({ stored: true, username: "researcher" }),
        );
        expect(bigQuery.credentials.bigQuery).toEqual(
          expect.objectContaining({
            stored: true,
            projectId: "clinical-project",
            serviceAccountJsonStored: true,
          }),
        );
        // @effect-diagnostics-next-line preferSchemaOverJson:off
        expect(JSON.stringify(bigQuery)).not.toContain("private_key");
        // @effect-diagnostics-next-line preferSchemaOverJson:off
        expect(JSON.stringify(physioNet)).not.toContain("secret-password");

        const cleared = yield* service.clearCredentials({ credentialKind: "all" });
        assert.deepStrictEqual(cleared.credentials, emptyCredentials);
      }).pipe(Effect.provide(makeLayer())),
    );

    it.effect("initializes DuckDB through m4 init and persists non-secret settings", () =>
      Effect.gen(function* () {
        const service = yield* M4DatasetService;

        yield* service.initialize({ datasetId: "mimic-iv-demo", backendId: "duckdb" });

        expect(mockInitialize).toHaveBeenCalledWith({
          cwd: process.cwd(),
          datasetId: "mimic-iv-demo",
          download: false,
          physioNetCredentialsFile: undefined,
        });
        expect(mockInitializeDerived).not.toHaveBeenCalled();
        expect(mockBackend).not.toHaveBeenCalled();
      }).pipe(Effect.provide(makeLayer())),
    );

    it.effect("defaults empty workspace settings to the managed datasets directory", () => {
      const baseDir = `${NodeOS.tmpdir().replace(/[\\/]$/, "")}/t3-m4-managed-datasets-${crypto.randomUUID()}`;
      return Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const service = yield* M4DatasetService;

        yield* service.getStatus();

        const expectedWorkspacePath = path.join(baseDir, "datasets");
        expect(mockStatus).toHaveBeenCalledWith(
          expect.objectContaining({ cwd: expectedWorkspacePath }),
        );
        expect(yield* fileSystem.exists(expectedWorkspacePath).pipe(Effect.orDie)).toBe(true);
      }).pipe(Effect.provide(makeLayer({}, baseDir)));
    });

    it.effect(
      "materializes saved PhysioNet credentials and derived tables for local MIMIC-IV",
      () =>
        Effect.gen(function* () {
          const fileSystem = yield* FileSystem.FileSystem;
          let credentialsFilePath: string | undefined;
          mockInitialize.mockImplementationOnce((input) =>
            Effect.gen(function* () {
              credentialsFilePath = input.physioNetCredentialsFile;
              expect(input.download).toBe(true);
              expect(credentialsFilePath).toBeDefined();
              const credentialsJson = yield* fileSystem
                .readFileString(credentialsFilePath!)
                .pipe(Effect.orDie);
              expect(credentialsJson).toBe(
                '{"username":"researcher","password":"secret-password"}',
              );
              return commandResult;
            }),
          );
          const service = yield* M4DatasetService;

          yield* service.savePhysioNetCredentials({
            username: "researcher",
            password: "secret-password",
          });
          yield* service.initialize({ datasetId: "mimic-iv", backendId: "duckdb" });

          expect(mockInitialize).toHaveBeenCalledWith({
            cwd: process.cwd(),
            datasetId: "mimic-iv",
            download: true,
            physioNetCredentialsFile: credentialsFilePath,
          });
          expect(mockInitializeDerived).toHaveBeenCalledWith({
            cwd: process.cwd(),
            datasetId: "mimic-iv",
          });
          const credentialFileStillExists =
            credentialsFilePath === undefined
              ? false
              : yield* fileSystem.exists(credentialsFilePath).pipe(Effect.orDie);
          expect(credentialFileStillExists).toBe(false);
        }).pipe(Effect.provide(makeLayer())),
    );

    it.effect("does not materialize derived tables for demo, notes, or eICU datasets", () =>
      Effect.gen(function* () {
        const service = yield* M4DatasetService;
        yield* service.savePhysioNetCredentials({
          username: "researcher",
          password: "secret-password",
        });

        yield* service.initialize({ datasetId: "mimic-iv-demo", backendId: "duckdb" });
        yield* service.initialize({ datasetId: "mimic-iv-note", backendId: "duckdb" });
        yield* service.initialize({ datasetId: "eicu", backendId: "duckdb" });

        expect(mockInitialize).toHaveBeenCalledTimes(3);
        expect(mockInitializeDerived).not.toHaveBeenCalled();
      }).pipe(Effect.provide(makeLayer())),
    );

    it.effect("uses PhysioNet-specific messaging for PhysioNet credential file failures", () =>
      Effect.gen(function* () {
        const service = yield* M4DatasetService;
        yield* service.savePhysioNetCredentials({
          username: "researcher",
          password: "secret-password",
        });

        const result = yield* Effect.result(
          service.initialize({ datasetId: "mimic-iv", backendId: "duckdb" }),
        );

        expect(Result.isFailure(result)).toBe(true);
        if (Result.isFailure(result)) {
          expect(result.failure.code).toBe("secret_store_error");
          expect(result.failure.actionableMessage).toContain("PhysioNet credentials");
          expect(result.failure.actionableMessage).not.toContain("BigQuery");
        }
      }).pipe(Effect.provide(makeLayer().pipe(Layer.provide(failingPhysioNetCredentialFileLayer)))),
    );

    it.effect("configures BigQuery with saved project credentials without m4 use", () =>
      Effect.gen(function* () {
        const service = yield* M4DatasetService;

        yield* service.saveBigQueryCredentials({
          projectId: "clinical-project",
          useApplicationDefaultCredentials: true,
        });
        yield* service.initialize({ datasetId: "mimic-iv", backendId: "bigquery" });

        expect(mockBackend).toHaveBeenCalledWith({
          cwd: process.cwd(),
          backendId: "bigquery",
          projectId: "clinical-project",
        });
        expect(mockStatus).toHaveBeenCalledWith({
          credentials: expect.objectContaining({
            bigQuery: expect.objectContaining({ projectId: "clinical-project", stored: true }),
          }),
          cwd: process.cwd(),
          datasetId: "mimic-iv",
          backendId: "bigquery",
          env: undefined,
        });
        expect(mockInitializeDerived).not.toHaveBeenCalled();
      }).pipe(Effect.provide(makeLayer())),
    );

    it.effect("materializes saved BigQuery service-account JSON only for scoped M4 calls", () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        let credentialFilePath: string | undefined;
        mockBackend.mockImplementationOnce((input) =>
          Effect.gen(function* () {
            credentialFilePath = input.env?.GOOGLE_APPLICATION_CREDENTIALS;
            expect(credentialFilePath).toBeDefined();
            const serviceAccountJson = yield* fileSystem
              .readFileString(credentialFilePath!)
              .pipe(Effect.orDie);
            expect(serviceAccountJson).toBe('{"private_key":"secret"}');
            return commandResult;
          }),
        );
        const service = yield* M4DatasetService;

        yield* service.saveBigQueryCredentials({
          projectId: "clinical-project",
          serviceAccountJson: '{"private_key":"secret"}',
          useApplicationDefaultCredentials: false,
        });
        yield* service.initialize({ datasetId: "mimic-iv", backendId: "bigquery" });

        expect(mockBackend).toHaveBeenCalledWith({
          cwd: process.cwd(),
          backendId: "bigquery",
          projectId: "clinical-project",
          env: { GOOGLE_APPLICATION_CREDENTIALS: credentialFilePath },
        });
        expect(mockStatus).toHaveBeenCalledWith(
          expect.objectContaining({
            datasetId: "mimic-iv",
            backendId: "bigquery",
            env: { GOOGLE_APPLICATION_CREDENTIALS: credentialFilePath },
          }),
        );
        const credentialFileStillExists =
          credentialFilePath === undefined
            ? false
            : yield* fileSystem.exists(credentialFilePath).pipe(Effect.orDie);
        expect(credentialFileStillExists).toBe(false);
      }).pipe(Effect.provide(makeLayer())),
    );

    it.effect("rejects invalid BigQuery credential saves before storing secrets", () =>
      Effect.gen(function* () {
        const service = yield* M4DatasetService;

        const result = yield* Effect.result(
          service.saveBigQueryCredentials({
            projectId: "clinical-project",
            serviceAccountJson: "{not-json",
            useApplicationDefaultCredentials: false,
          }),
        );

        expect(Result.isFailure(result)).toBe(true);
        if (Result.isFailure(result)) {
          expect(result.failure.code).toBe("invalid_credentials");
        }
        const status = yield* service.getStatus();
        expect(status.credentials.bigQuery.stored).toBe(false);
      }).pipe(Effect.provide(makeLayer())),
    );

    it.effect("requires BigQuery credentials before BigQuery setup", () =>
      Effect.gen(function* () {
        const service = yield* M4DatasetService;
        const result = yield* Effect.result(
          service.initialize({ datasetId: "mimic-iv", backendId: "bigquery" }),
        );

        expect(Result.isFailure(result)).toBe(true);
        if (Result.isFailure(result)) {
          expect(result.failure.code).toBe("missing_credentials");
        }
        expect(mockBackend).not.toHaveBeenCalled();
      }).pipe(Effect.provide(makeLayer())),
    );

    it.effect("rejects duplicate initialization for the same dataset/backend", () =>
      Effect.gen(function* () {
        const entered = yield* Deferred.make<void>();
        mockInitialize.mockImplementationOnce(() =>
          Deferred.succeed(entered, undefined).pipe(Effect.andThen(Effect.never)),
        );
        const service = yield* M4DatasetService;
        yield* service.savePhysioNetCredentials({
          username: "researcher",
          password: "secret-password",
        });

        const first = yield* service
          .initialize({ datasetId: "mimic-iv-demo", backendId: "duckdb" })
          .pipe(Effect.forkScoped);
        yield* Deferred.await(entered);

        const duplicate = yield* Effect.result(
          service.initialize({ datasetId: "mimic-iv-demo", backendId: "duckdb" }),
        );
        yield* Fiber.interrupt(first);

        expect(Result.isFailure(duplicate)).toBe(true);
        if (Result.isFailure(duplicate)) {
          expect(duplicate.failure.code).toBe("dataset_operation_in_progress");
        }
      }).pipe(Effect.provide(makeLayer())),
    );

    it.effect("reports running initialization through status snapshots", () =>
      Effect.gen(function* () {
        const entered = yield* Deferred.make<void>();
        mockInitialize.mockImplementationOnce(() =>
          Deferred.succeed(entered, undefined).pipe(Effect.andThen(Effect.never)),
        );
        const service = yield* M4DatasetService;

        const init = yield* service
          .initialize({ datasetId: "mimic-iv-demo", backendId: "duckdb" })
          .pipe(Effect.forkScoped);
        yield* Deferred.await(entered);

        const status = yield* service.getStatus();
        yield* Fiber.interrupt(init);

        expect(status.datasets[0]).toEqual(
          expect.objectContaining({
            datasetId: "mimic-iv-demo",
            backendId: "duckdb",
            readiness: "initializing",
            operation: expect.objectContaining({
              datasetId: "mimic-iv-demo",
              backendId: "duckdb",
              state: "running",
            }),
          }),
        );
        expect(status.appReadiness.readiness).toBe("initializing");
        expect(status.appReadiness.clinicalDataReady).toBe(false);
      }).pipe(Effect.provide(makeLayer())),
    );

    it.effect("allows different initialization keys to proceed independently", () =>
      Effect.gen(function* () {
        const firstEntered = yield* Deferred.make<void>();
        const secondEntered = yield* Deferred.make<void>();
        mockInitialize
          .mockImplementationOnce(() =>
            Deferred.succeed(firstEntered, undefined).pipe(Effect.andThen(Effect.never)),
          )
          .mockImplementationOnce(() =>
            Deferred.succeed(secondEntered, undefined).pipe(Effect.andThen(Effect.never)),
          );
        const service = yield* M4DatasetService;
        yield* service.savePhysioNetCredentials({
          username: "researcher",
          password: "secret-password",
        });

        const first = yield* service
          .initialize({ datasetId: "mimic-iv-demo", backendId: "duckdb" })
          .pipe(Effect.forkScoped);
        yield* Deferred.await(firstEntered);
        const second = yield* service
          .initialize({ datasetId: "eicu", backendId: "duckdb" })
          .pipe(Effect.forkScoped);
        yield* Deferred.await(secondEntered);

        yield* Fiber.interrupt(first);
        yield* Fiber.interrupt(second);
        expect(mockInitialize).toHaveBeenCalledTimes(2);
      }).pipe(Effect.provide(makeLayer())),
    );
  });
});
