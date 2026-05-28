import { assert, beforeEach, describe, expect, it, vi } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Result from "effect/Result";
import { ChildProcessSpawner } from "effect/unstable/process";

import type { DatasetCredentialPresence } from "@t3tools/contracts";

import { type ProcessRunnerShape, ProcessRunner } from "../processRunner.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import { M4Cli } from "./M4Cli.ts";
import * as M4CliLayer from "./M4Cli.ts";

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
      parquet_present: true,
      db_present: true,
      parquet_root: "/repo/m4_data/parquet/mimic-iv-demo",
      db_path: "/repo/m4_data/duckdb/mimic-iv-demo.duckdb",
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

const commandJson = JSON.stringify({
  version: 1,
  ok: true,
  command: "use",
  active_dataset: "mimic-iv-demo",
  backend: "duckdb",
  warnings: [],
});

const mockRun = vi.fn<ProcessRunnerShape["run"]>();

const makeLayer = (m4Command = "") =>
  M4CliLayer.layer.pipe(
    Layer.provide(
      Layer.mock(ProcessRunner)({
        run: mockRun,
      }),
    ),
    Layer.provide(
      ServerSettingsService.layerTest({
        datasets: {
          workspacePath: "",
          preferredBackendId: "duckdb",
          m4Command,
        },
      }),
    ),
  );

beforeEach(() => {
  mockRun.mockReset();
});

describe("M4Cli", () => {
  it.effect("uses uvx --from m4-infra m4 by default and maps status JSON", () =>
    Effect.gen(function* () {
      mockRun.mockReturnValueOnce(Effect.succeed(processOutput(statusJson)));

      const m4 = yield* M4Cli;
      expect(m4.defaultCommand).toBe("uvx --from m4-infra m4");

      const status = yield* m4.status({ cwd: "/repo", credentials: emptyCredentials });
      const dataset = status.datasets[0]!;
      expect(dataset).toBeDefined();

      assert.deepStrictEqual(dataset, {
        datasetId: "mimic-iv-demo",
        backendId: "duckdb",
        readiness: "ready",
        initialized: true,
        active: true,
        path: "/repo/m4_data/duckdb/mimic-iv-demo.duckdb",
        tables: [{ name: "primary", ready: true, rowCount: 100 }],
        lastCheckedAt: dataset.lastCheckedAt,
      });
      expect(status.runtime.command).toBe("uvx --from m4-infra m4");
      expect(mockRun).toHaveBeenCalledWith(
        expect.objectContaining({
          command: "uvx",
          args: ["--from", "m4-infra", "m4", "status", "--all", "--json"],
          cwd: "/repo",
        }),
      );
    }).pipe(Effect.provide(makeLayer())),
  );

  it.effect("splits configured commands and appends lifecycle arguments", () =>
    Effect.gen(function* () {
      mockRun.mockReturnValueOnce(Effect.succeed(processOutput(commandJson)));

      const m4 = yield* M4Cli;
      expect(m4.resolveCommand("uv run m4")).toEqual({
        command: "uv",
        prefixArgs: ["run", "m4"],
      });

      yield* m4.use({ cwd: "/repo", datasetId: "mimic-iv-demo" });

      expect(mockRun).toHaveBeenCalledWith(
        expect.objectContaining({
          command: "uv",
          args: ["run", "m4", "use", "mimic-iv-demo", "--json"],
        }),
      );
    }).pipe(Effect.provide(makeLayer("uv run m4"))),
  );

  it.effect("builds init, use, and backend JSON commands", () =>
    Effect.gen(function* () {
      mockRun.mockReturnValue(Effect.succeed(processOutput(commandJson)));

      const m4 = yield* M4Cli;
      yield* m4.initialize({ cwd: "/repo", datasetId: "mimic-iv-demo" });
      yield* m4.use({ cwd: "/repo", datasetId: "mimic-iv-demo" });
      yield* m4.backend({ cwd: "/repo", backendId: "bigquery", projectId: "clinical-project" });

      expect(mockRun.mock.calls.map(([input]) => input.args)).toEqual([
        ["--from", "m4-infra", "m4", "init", "mimic-iv-demo", "--json"],
        ["--from", "m4-infra", "m4", "use", "mimic-iv-demo", "--json"],
        [
          "--from",
          "m4-infra",
          "m4",
          "backend",
          "bigquery",
          "--project-id",
          "clinical-project",
          "--json",
        ],
      ]);
    }).pipe(Effect.provide(makeLayer())),
  );

  it.effect("maps JSON command error envelopes to m4_command_failed", () =>
    Effect.gen(function* () {
      mockRun.mockReturnValueOnce(
        Effect.succeed(
          processOutput(
            // @effect-diagnostics-next-line preferSchemaOverJson:off
            JSON.stringify({
              version: 1,
              ok: false,
              command: "backend",
              error: {
                code: "project_id_required",
                message: "BigQuery backend requires a project ID.",
                hint: "Set it with: m4 backend bigquery --project-id <ID>",
              },
            }),
            1,
          ),
        ),
      );

      const m4 = yield* M4Cli;
      const result = yield* Effect.result(m4.backend({ cwd: "/repo", backendId: "bigquery" }));

      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure.code).toBe("m4_command_failed");
        expect(result.failure.actionableMessage).toContain("--project-id");
      }
    }).pipe(Effect.provide(makeLayer())),
  );

  it.effect("maps malformed JSON and older human output distinctly", () =>
    Effect.gen(function* () {
      mockRun
        .mockReturnValueOnce(Effect.succeed(processOutput("{not json")))
        .mockReturnValueOnce(Effect.succeed(processOutput("M4 status table")));

      const m4 = yield* M4Cli;
      const malformed = yield* Effect.result(
        m4.status({ cwd: "/repo", credentials: emptyCredentials }),
      );
      const human = yield* Effect.result(
        m4.status({ cwd: "/repo", credentials: emptyCredentials }),
      );

      expect(Result.isFailure(malformed)).toBe(true);
      expect(Result.isFailure(human)).toBe(true);
      if (Result.isFailure(malformed)) {
        expect(malformed.failure.code).toBe("invalid_m4_status");
      }
      if (Result.isFailure(human)) {
        expect(human.failure.code).toBe("m4_unavailable");
      }
    }).pipe(Effect.provide(makeLayer())),
  );
});
