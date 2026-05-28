import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, beforeEach, describe, expect, it, vi } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
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
    active: true,
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
      activeDatasetId: dataset.datasetId,
      activeBackendId: dataset.backendId,
      clinicalDataReady: true,
      readiness: "ready",
      lastCheckedAt: "2026-05-28T10:00:00.000Z",
    },
  };
}

const mockStatus = vi.fn<M4CliShape["status"]>();
const mockInitialize = vi.fn<M4CliShape["initialize"]>();
const mockUse = vi.fn<M4CliShape["use"]>();
const mockBackend = vi.fn<M4CliShape["backend"]>();

const makeLayer = (settingsOverrides: Parameters<typeof ServerSettingsService.layerTest>[0] = {}) =>
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
          status: mockStatus,
          initialize: mockInitialize,
          use: mockUse,
          backend: mockBackend,
        }),
      ),
    ),
    Layer.provide(ServerSecretStoreLive),
    Layer.provide(ServerSettingsService.layerTest(settingsOverrides)),
    Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-m4-dataset-service-test-" })),
  );

beforeEach(() => {
  mockStatus.mockReset();
  mockInitialize.mockReset();
  mockUse.mockReset();
  mockBackend.mockReset();
  mockStatus.mockImplementation(({ credentials }) => Effect.succeed(statusResult(credentials)));
  mockInitialize.mockReturnValue(Effect.succeed(commandResult));
  mockUse.mockReturnValue(Effect.succeed(commandResult));
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
        });
        expect(mockBackend).not.toHaveBeenCalled();
      }).pipe(Effect.provide(makeLayer())),
    );

    it.effect("activates BigQuery with saved project credentials", () =>
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
        expect(mockUse).toHaveBeenCalledWith({
          cwd: process.cwd(),
          datasetId: "mimic-iv",
        });
      }).pipe(Effect.provide(makeLayer())),
    );

    it.effect("requires BigQuery credentials before activation", () =>
      Effect.gen(function* () {
        const service = yield* M4DatasetService;
        const result = yield* Effect.result(
          service.setActiveDataset({ datasetId: "mimic-iv", backendId: "bigquery" }),
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
