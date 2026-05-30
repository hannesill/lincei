// @effect-diagnostics-next-line nodeBuiltinImport:off - Synchronous temp fixtures keep these gateway tests small.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
// @effect-diagnostics-next-line nodeBuiltinImport:off - Synchronous temp fixtures keep these gateway tests small.
import { join } from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, beforeEach, describe, expect, it, vi } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Result from "effect/Result";
import { ChildProcessSpawner } from "effect/unstable/process";

import { type DatasetCredentialPresence } from "@t3tools/contracts";

import { ServerConfig } from "../config.ts";
import { ServerSecretStoreLive } from "../auth/Layers/ServerSecretStore.ts";
import { type ProcessRunnerShape, ProcessRunner } from "../processRunner.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import {
  DATASET_CONTEXT_SAFE_COMMAND_GUIDANCE,
  formatDatasetContextMarkdown,
  LinceiDatasetGateway,
  type DatasetAccessPolicy,
} from "./LinceiDatasetGateway.ts";
import * as LinceiDatasetGatewayLayer from "./LinceiDatasetGateway.ts";
import * as M4CliLayer from "./M4Cli.ts";
import * as M4DatasetServiceLayer from "./M4DatasetService.ts";

const emptyCredentials: DatasetCredentialPresence = {
  physioNet: { stored: false },
  bigQuery: {
    stored: false,
    serviceAccountJsonStored: false,
    applicationDefaultCredentials: false,
  },
};

const processOutput = (stdout: string, code = 0, stderr = "") => ({
  stdout,
  stderr,
  code: ChildProcessSpawner.ExitCode(code),
  timedOut: false,
  stdoutTruncated: false,
  stderrTruncated: false,
});

const statusJson = JSON.stringify({
  version: 1,
  active_dataset: "mimic-iv-demo",
  backend: "duckdb",
  bigquery_project_id: null,
  datasets: [
    {
      name: "mimic-iv-demo",
      active: true,
      raw_present: true,
      parquet_present: true,
      db_present: true,
      requires_authentication: false,
      download_available: true,
      setup_state: "ready",
      bigquery_available: false,
      row_count: 100,
      parquet_size_gb: 0.01,
      derived: {
        supported: false,
        total: null,
        materialized: null,
        bigquery: false,
      },
      warnings: [],
    },
  ],
});

const mockRun = vi.fn<ProcessRunnerShape["run"]>();

const makeLayer = (input: {
  readonly callerCwd: string;
  readonly baseDir: string;
  readonly workspacePath: string;
  readonly policy?: DatasetAccessPolicy | undefined;
}) => {
  const settingsLayer = ServerSettingsService.layerTest({
    datasets: {
      workspacePath: input.workspacePath,
      preferredBackendId: "duckdb",
      activeDatasetId: "mimic-iv-demo",
      m4Command: "",
    },
  });
  const processRunnerLayer = Layer.mock(ProcessRunner)({
    run: mockRun,
  });
  const baseLayer = Layer.mergeAll(processRunnerLayer, settingsLayer, ServerSecretStoreLive);
  const m4CliLayer = M4CliLayer.layer.pipe(Layer.provideMerge(baseLayer));
  const datasetServiceLayer = M4DatasetServiceLayer.layer.pipe(
    Layer.provideMerge(m4CliLayer),
    Layer.provideMerge(baseLayer),
  );
  const gatewayLayer = (
    input.policy
      ? LinceiDatasetGatewayLayer.layerWithPolicy(input.policy)
      : LinceiDatasetGatewayLayer.layer
  ).pipe(
    Layer.provideMerge(datasetServiceLayer),
    Layer.provideMerge(m4CliLayer),
    Layer.provideMerge(baseLayer),
  );

  return gatewayLayer.pipe(
    Layer.provide(ServerConfig.layerTest(input.callerCwd, input.baseDir)),
    Layer.provide(NodeServices.layer),
  );
};

beforeEach(() => {
  mockRun.mockReset();
});

describe("LinceiDatasetGateway", () => {
  it.effect("resolves status to uvx --from m4-infra m4 in the dataset workspace", () => {
    const callerCwd = mkdtempSync(join(tmpdir(), "lincei-gateway-status-caller-"));
    const baseDir = mkdtempSync(join(tmpdir(), "lincei-gateway-status-base-"));
    const workspacePath = mkdtempSync(join(tmpdir(), "lincei-gateway-status-workspace-"));

    return Effect.gen(function* () {
      mockRun.mockReturnValueOnce(Effect.succeed(processOutput(statusJson)));

      const gateway = yield* LinceiDatasetGateway;
      const status = yield* gateway.status();

      expect(status.credentials).toEqual(emptyCredentials);
      expect(status.runtime.command).toBe("uvx --from m4-infra m4");
      expect(mockRun).toHaveBeenCalledWith(
        expect.objectContaining({
          command: "uvx",
          args: ["--from", "m4-infra", "m4", "status", "--all", "--json", "--no-interactive"],
          cwd: workspacePath,
        }),
      );
    }).pipe(Effect.provide(makeLayer({ callerCwd, baseDir, workspacePath })));
  });

  it.effect("ignores study-local M4 project files when resolving the launcher", () => {
    const callerCwd = mkdtempSync(join(tmpdir(), "lincei-gateway-local-caller-"));
    const baseDir = mkdtempSync(join(tmpdir(), "lincei-gateway-local-base-"));
    const workspacePath = mkdtempSync(join(tmpdir(), "lincei-gateway-local-workspace-"));
    writeFileSync(join(callerCwd, "pyproject.toml"), "[project]\nname = 'study-local-m4'\n");
    writeFileSync(join(callerCwd, "uv.lock"), "");

    return Effect.gen(function* () {
      mockRun.mockReturnValueOnce(Effect.succeed(processOutput(statusJson)));

      const gateway = yield* LinceiDatasetGateway;
      yield* gateway.status();

      expect(mockRun).toHaveBeenCalledWith(
        expect.objectContaining({
          command: "uvx",
          args: expect.arrayContaining(["--from", "m4-infra", "m4"]),
          cwd: workspacePath,
        }),
      );
    }).pipe(Effect.provide(makeLayer({ callerCwd, baseDir, workspacePath })));
  });

  it.effect("routes schema and query through the configured dataset workspace", () => {
    const callerCwd = mkdtempSync(join(tmpdir(), "lincei-gateway-read-caller-"));
    const baseDir = mkdtempSync(join(tmpdir(), "lincei-gateway-read-base-"));
    const workspacePath = mkdtempSync(join(tmpdir(), "lincei-gateway-read-workspace-"));
    const schemaJson = '{"tables":[]}';
    const queryJson = '{"rows":[]}';

    return Effect.gen(function* () {
      mockRun
        .mockReturnValueOnce(Effect.succeed(processOutput(schemaJson)))
        .mockReturnValueOnce(Effect.succeed(processOutput(queryJson)));

      const gateway = yield* LinceiDatasetGateway;
      yield* gateway.schema();
      yield* gateway.query({ sql: "select 1" });

      expect(mockRun).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          cwd: workspacePath,
          args: [
            "--from",
            "m4-infra",
            "m4",
            "schema",
            "--dataset",
            "mimic-iv-demo",
            "--backend",
            "duckdb",
            "--json",
            "--no-interactive",
          ],
        }),
      );
      expect(mockRun).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          cwd: workspacePath,
          args: [
            "--from",
            "m4-infra",
            "m4",
            "query",
            "--sql",
            "select 1",
            "--dataset",
            "mimic-iv-demo",
            "--backend",
            "duckdb",
            "--json",
            "--no-interactive",
          ],
        }),
      );
    }).pipe(Effect.provide(makeLayer({ callerCwd, baseDir, workspacePath })));
  });

  it.effect("emits safe markdown guidance for agent prompts", () => {
    const callerCwd = mkdtempSync(join(tmpdir(), "lincei-gateway-context-caller-"));
    const baseDir = mkdtempSync(join(tmpdir(), "lincei-gateway-context-base-"));
    const workspacePath = mkdtempSync(join(tmpdir(), "lincei-gateway-context-workspace-"));

    return Effect.gen(function* () {
      mockRun.mockReturnValueOnce(Effect.succeed(processOutput(statusJson)));

      const gateway = yield* LinceiDatasetGateway;
      const context = yield* gateway.context();
      const markdown = formatDatasetContextMarkdown(context);

      assert.isTrue(markdown.includes(DATASET_CONTEXT_SAFE_COMMAND_GUIDANCE));
      assert.isTrue(markdown.includes("lincei dataset status"));
      assert.isTrue(markdown.includes("Do not call bare `m4`, `uvx m4`, or `uv run m4` directly."));
    }).pipe(Effect.provide(makeLayer({ callerCwd, baseDir, workspacePath })));
  });

  it.effect("rejects disallowed datasets and tools through policy", () => {
    const callerCwd = mkdtempSync(join(tmpdir(), "lincei-gateway-policy-caller-"));
    const baseDir = mkdtempSync(join(tmpdir(), "lincei-gateway-policy-base-"));
    const workspacePath = mkdtempSync(join(tmpdir(), "lincei-gateway-policy-workspace-"));

    return Effect.gen(function* () {
      const gateway = yield* LinceiDatasetGateway;
      const datasetResult = yield* Effect.result(gateway.status({ datasetId: "mimic-iv" }));
      const toolResult = yield* Effect.result(gateway.query({ sql: "select 1" }));

      if (Result.isSuccess(datasetResult) || Result.isSuccess(toolResult)) {
        assert.fail("Expected policy failures.");
      }
      expect(datasetResult.failure.code).toBe("policy_denied");
      expect(toolResult.failure.code).toBe("policy_denied");
    }).pipe(
      Effect.provide(
        makeLayer({
          callerCwd,
          baseDir,
          workspacePath,
          policy: {
            allowedDatasets: ["mimic-iv-demo"],
            allowedBackends: ["duckdb"],
            allowedTools: ["status"],
            allowRawPaths: true,
            allowMutations: true,
          },
        }),
      ),
    );
  });

  it.effect("rejects mutating SQL in dataset query", () => {
    const callerCwd = mkdtempSync(join(tmpdir(), "lincei-gateway-sql-policy-caller-"));
    const baseDir = mkdtempSync(join(tmpdir(), "lincei-gateway-sql-policy-base-"));
    const workspacePath = mkdtempSync(join(tmpdir(), "lincei-gateway-sql-policy-workspace-"));

    return Effect.gen(function* () {
      const gateway = yield* LinceiDatasetGateway;
      const result = yield* Effect.result(gateway.query({ sql: "drop table patients" }));

      if (Result.isSuccess(result)) {
        assert.fail("Expected read-only SQL policy failure.");
      }
      expect(result.failure.code).toBe("policy_denied");
      expect(mockRun).not.toHaveBeenCalled();
    }).pipe(Effect.provide(makeLayer({ callerCwd, baseDir, workspacePath })));
  });
});
