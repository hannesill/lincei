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

const processOutput = (stdout: string, code = 0, stderr = "", stdoutTruncated = false) => ({
  stdout,
  stderr,
  code: ChildProcessSpawner.ExitCode(code),
  timedOut: false,
  stdoutTruncated,
  stderrTruncated: false,
});

const statusJson = JSON.stringify({
  version: 1,
  selected_dataset: "mimic-iv-demo",
  backend: "duckdb",
  bigquery_project_id: null,
  datasets: [
    {
      name: "mimic-iv-demo",
      selected: true,
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

const commandJson = JSON.stringify({
  version: 1,
  ok: true,
  command: "backend",
  selected_dataset: "mimic-iv-demo",
  backend: "duckdb",
  warnings: [],
});

const initNdjson = [
  JSON.stringify({
    version: 1,
    sequence: 1,
    time: 1,
    event: "operation_started",
    command: "init",
    dataset: "mimic-iv",
    download: true,
    no_interactive: true,
  }),
  JSON.stringify({
    version: 1,
    sequence: 2,
    time: 2,
    event: "operation_completed",
    command: "init",
    result: {
      version: 1,
      ok: true,
      command: "init",
      dataset: "mimic-iv",
      warnings: [],
    },
  }),
].join("\n");

const initDerivedNdjson = [
  JSON.stringify({
    version: 1,
    sequence: 1,
    time: 1,
    event: "operation_started",
    command: "init-derived",
    dataset: "mimic-iv",
  }),
  JSON.stringify({
    version: 1,
    sequence: 2,
    time: 2,
    event: "operation_completed",
    command: "init-derived",
    result: {
      version: 1,
      ok: true,
      command: "init-derived",
      dataset: "mimic-iv",
      warnings: [],
    },
  }),
].join("\n");

const failedNdjson = [
  JSON.stringify({
    version: 1,
    sequence: 1,
    time: 1,
    event: "operation_started",
    command: "init",
    dataset: "mimic-iv",
  }),
  JSON.stringify({
    version: 1,
    sequence: 2,
    time: 2,
    event: "operation_failed",
    command: "init",
    error: {
      code: "download_failed",
      message: "PhysioNet download failed.",
      hint: "Check PhysioNet credentials.",
    },
  }),
].join("\n");

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
  it.effect("uses the supported M4 package range by default and maps status JSON", () =>
    Effect.gen(function* () {
      mockRun.mockReturnValueOnce(Effect.succeed(processOutput(statusJson)));

      const m4 = yield* M4Cli;
      expect(m4.defaultCommand).toBe("uvx --from 'm4-infra>=0.5.4,<0.6' m4");

      const status = yield* m4.status({ cwd: "/repo", credentials: emptyCredentials });
      const dataset = status.datasets[0]!;
      expect(dataset).toBeDefined();

      assert.deepStrictEqual(dataset, {
        datasetId: "mimic-iv-demo",
        backendId: "duckdb",
        readiness: "ready",
        initialized: true,
        selected: true,
        tables: [{ name: "primary", ready: true, rowCount: 100 }],
        lastCheckedAt: dataset.lastCheckedAt,
      });
      expect(status.runtime.command).toBe("uvx --from 'm4-infra>=0.5.4,<0.6' m4");
      expect(mockRun).toHaveBeenCalledWith(
        expect.objectContaining({
          command: "uvx",
          args: [
            "--from",
            "m4-infra>=0.5.4,<0.6",
            "m4",
            "status",
            "--all",
            "--json",
            "--no-interactive",
          ],
          cwd: "/repo",
        }),
      );
    }).pipe(Effect.provide(makeLayer())),
  );

  it.effect("maps M4 derived table readiness into dataset snapshots", () =>
    Effect.gen(function* () {
      mockRun.mockReturnValueOnce(
        Effect.succeed(
          processOutput(
            // @effect-diagnostics-next-line preferSchemaOverJson:off
            JSON.stringify({
              version: 1,
              selected_dataset: "mimic-iv",
              backend: "duckdb",
              bigquery_project_id: null,
              datasets: [
                {
                  name: "mimic-iv",
                  selected: true,
                  raw_present: true,
                  parquet_present: true,
                  db_present: true,
                  requires_authentication: true,
                  download_available: true,
                  setup_state: "ready",
                  bigquery_available: false,
                  row_count: 1000,
                  parquet_size_gb: 1.25,
                  derived: {
                    supported: true,
                    total: 20,
                    materialized: 12,
                    bigquery: false,
                  },
                  warnings: [],
                },
              ],
            }),
          ),
        ),
      );

      const m4 = yield* M4Cli;
      const status = yield* m4.status({
        cwd: "/repo",
        credentials: {
          ...emptyCredentials,
          physioNet: { stored: true, username: "researcher" },
        },
      });

      expect(status.datasets[0]?.derivedTables).toEqual({
        supported: true,
        ready: false,
        total: 20,
        materialized: 12,
        backendAvailable: false,
      });
    }).pipe(Effect.provide(makeLayer())),
  );

  it.effect("passes request-scoped dataset and backend to status", () =>
    Effect.gen(function* () {
      mockRun.mockReturnValueOnce(Effect.succeed(processOutput(statusJson)));

      const m4 = yield* M4Cli;
      yield* m4.status({
        cwd: "/repo",
        credentials: emptyCredentials,
        datasetId: "mimic-iv-demo",
        backendId: "duckdb",
      });

      expect(mockRun).toHaveBeenCalledWith(
        expect.objectContaining({
          args: [
            "--from",
            "m4-infra>=0.5.4,<0.6",
            "m4",
            "status",
            "--dataset",
            "mimic-iv-demo",
            "--backend",
            "duckdb",
            "--json",
            "--no-interactive",
          ],
        }),
      );
    }).pipe(Effect.provide(makeLayer())),
  );

  it.effect("passes request-scoped backend to all-dataset status", () =>
    Effect.gen(function* () {
      mockRun.mockReturnValueOnce(Effect.succeed(processOutput(statusJson)));

      const m4 = yield* M4Cli;
      yield* m4.status({
        cwd: "/repo",
        credentials: emptyCredentials,
        backendId: "bigquery",
      });

      expect(mockRun).toHaveBeenCalledWith(
        expect.objectContaining({
          args: [
            "--from",
            "m4-infra>=0.5.4,<0.6",
            "m4",
            "status",
            "--all",
            "--backend",
            "bigquery",
            "--json",
            "--no-interactive",
          ],
        }),
      );
    }).pipe(Effect.provide(makeLayer())),
  );

  it.effect("passes M4 0.5.3 paths flag when status paths are requested", () =>
    Effect.gen(function* () {
      mockRun.mockReturnValueOnce(Effect.succeed(processOutput(statusJson)));

      const m4 = yield* M4Cli;
      yield* m4.status({
        cwd: "/repo",
        credentials: emptyCredentials,
        includePaths: true,
      });

      expect(mockRun).toHaveBeenCalledWith(
        expect.objectContaining({
          args: [
            "--from",
            "m4-infra>=0.5.4,<0.6",
            "m4",
            "status",
            "--all",
            "--paths",
            "--json",
            "--no-interactive",
          ],
        }),
      );
    }).pipe(Effect.provide(makeLayer())),
  );

  it.effect("decodes older M4 active status fields as selected compatibility fields", () =>
    Effect.gen(function* () {
      mockRun.mockReturnValueOnce(
        Effect.succeed(
          processOutput(
            // @effect-diagnostics-next-line preferSchemaOverJson:off
            JSON.stringify({
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
            }),
          ),
        ),
      );

      const m4 = yield* M4Cli;
      const status = yield* m4.status({ cwd: "/repo", credentials: emptyCredentials });

      expect(status.datasets[0]?.selected).toBe(true);
      expect(status.appReadiness.selectedDatasetId).toBe("mimic-iv-demo");
    }).pipe(Effect.provide(makeLayer())),
  );

  it.effect("maps failed M4 setup states to failed dataset readiness with warning detail", () =>
    Effect.gen(function* () {
      mockRun.mockReturnValueOnce(
        Effect.succeed(
          processOutput(
            // @effect-diagnostics-next-line preferSchemaOverJson:off
            JSON.stringify({
              version: 1,
              selected_dataset: "mimic-iv",
              backend: "duckdb",
              bigquery_project_id: null,
              datasets: [
                {
                  name: "mimic-iv",
                  selected: true,
                  raw_present: false,
                  parquet_present: false,
                  db_present: false,
                  requires_authentication: true,
                  download_available: true,
                  setup_state: "download_failed",
                  bigquery_available: false,
                  row_count: null,
                  parquet_size_gb: null,
                  derived: {
                    supported: true,
                    total: 20,
                    materialized: 0,
                    bigquery: false,
                  },
                  warnings: ["PhysioNet credentials were rejected."],
                },
              ],
            }),
          ),
        ),
      );

      const m4 = yield* M4Cli;
      const status = yield* m4.status({ cwd: "/repo", credentials: emptyCredentials });
      const dataset = status.datasets[0]!;

      expect(dataset.readiness).toBe("failed");
      expect(dataset.error).toEqual(
        expect.objectContaining({
          code: "dataset_initialization_failed",
          detail: expect.stringContaining("setup_state=download_failed"),
        }),
      );
      expect(dataset.error?.detail).toContain("PhysioNet credentials were rejected.");
      expect(status.appReadiness.readiness).toBe("failed");
      expect(status.appReadiness.clinicalDataReady).toBe(false);
      expect(status.appReadiness.error).toEqual(dataset.error);
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

      yield* m4.backend({ cwd: "/repo", backendId: "duckdb" });

      expect(mockRun).toHaveBeenCalledWith(
        expect.objectContaining({
          command: "uv",
          args: ["run", "m4", "backend", "duckdb", "--json"],
        }),
      );
    }).pipe(Effect.provide(makeLayer("uv run m4"))),
  );

  it.effect("builds init, init-derived, and backend JSON commands", () =>
    Effect.gen(function* () {
      mockRun
        .mockReturnValueOnce(Effect.succeed(processOutput(initNdjson)))
        .mockReturnValueOnce(Effect.succeed(processOutput(initDerivedNdjson)))
        .mockReturnValueOnce(Effect.succeed(processOutput(commandJson)));

      const m4 = yield* M4Cli;
      yield* m4.initialize({
        cwd: "/repo",
        datasetId: "mimic-iv",
        download: true,
        physioNetCredentialsFile: "/tmp/physionet.json",
      });
      yield* m4.initializeDerived({ cwd: "/repo", datasetId: "mimic-iv" });
      yield* m4.backend({ cwd: "/repo", backendId: "bigquery", projectId: "clinical-project" });

      expect(mockRun.mock.calls.map(([input]) => input.args)).toEqual([
        [
          "--from",
          "m4-infra>=0.5.4,<0.6",
          "m4",
          "init",
          "mimic-iv",
          "--json",
          "--events",
          "ndjson",
          "--no-interactive",
          "--download",
          "--physionet-credentials-file",
          "/tmp/physionet.json",
        ],
        [
          "--from",
          "m4-infra>=0.5.4,<0.6",
          "m4",
          "init-derived",
          "mimic-iv",
          "--json",
          "--events",
          "ndjson",
          "--no-interactive",
        ],
        [
          "--from",
          "m4-infra>=0.5.4,<0.6",
          "m4",
          "backend",
          "bigquery",
          "--project-id",
          "clinical-project",
          "--json",
        ],
      ]);
      expect(mockRun.mock.calls[0]?.[0]).toEqual(
        expect.objectContaining({
          outputMode: "tail",
        }),
      );
      expect(mockRun.mock.calls[1]?.[0]).toEqual(
        expect.objectContaining({
          outputMode: "tail",
        }),
      );
    }).pipe(Effect.provide(makeLayer())),
  );

  it.effect("passes --force only when init-derived explicitly requests it", () =>
    Effect.gen(function* () {
      mockRun.mockReturnValueOnce(Effect.succeed(processOutput(initDerivedNdjson)));

      const m4 = yield* M4Cli;
      yield* m4.initializeDerived({ cwd: "/repo", datasetId: "mimic-iv", force: true });

      expect(mockRun.mock.calls[0]?.[0].args).toEqual([
        "--from",
        "m4-infra>=0.5.4,<0.6",
        "m4",
        "init-derived",
        "mimic-iv",
        "--json",
        "--events",
        "ndjson",
        "--no-interactive",
        "--force",
      ]);
    }).pipe(Effect.provide(makeLayer())),
  );

  it.effect("passes scoped credential environment to M4 subprocesses", () =>
    Effect.gen(function* () {
      mockRun.mockReturnValueOnce(Effect.succeed(processOutput(statusJson)));

      const m4 = yield* M4Cli;
      yield* m4.status({
        cwd: "/repo",
        credentials: emptyCredentials,
        env: { GOOGLE_APPLICATION_CREDENTIALS: "/tmp/service-account.json" },
      });

      expect(mockRun).toHaveBeenCalledWith(
        expect.objectContaining({
          env: { GOOGLE_APPLICATION_CREDENTIALS: "/tmp/service-account.json" },
        }),
      );
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

  it.effect("decodes terminal completion from retained NDJSON tail", () =>
    Effect.gen(function* () {
      const progress = Array.from({ length: 64 }, (_, index) =>
        JSON.stringify({
          version: 1,
          sequence: index + 1,
          event: "progress",
          message: "x".repeat(4096),
        }),
      ).join("\n");
      mockRun.mockReturnValueOnce(
        Effect.succeed(processOutput(`${progress}\n${initNdjson}`, 0, "", true)),
      );

      const m4 = yield* M4Cli;
      const result = yield* m4.initialize({ cwd: "/repo", datasetId: "mimic-iv" });

      expect(result.ok).toBe(true);
      expect(result.command).toBe("init");
    }).pipe(Effect.provide(makeLayer())),
  );

  it.effect("maps terminal NDJSON failures to m4_command_failed", () =>
    Effect.gen(function* () {
      mockRun.mockReturnValueOnce(Effect.succeed(processOutput(failedNdjson, 1)));

      const m4 = yield* M4Cli;
      const result = yield* Effect.result(m4.initialize({ cwd: "/repo", datasetId: "mimic-iv" }));

      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure.code).toBe("m4_command_failed");
        expect(result.failure.actionableMessage).toContain("PhysioNet credentials");
      }
    }).pipe(Effect.provide(makeLayer())),
  );

  it.effect("ignores malformed retained first line when a later terminal event exists", () =>
    Effect.gen(function* () {
      mockRun.mockReturnValueOnce(
        Effect.succeed(processOutput(`not-a-complete-json-line\n${initNdjson}`, 0, "", true)),
      );

      const m4 = yield* M4Cli;
      const result = yield* m4.initialize({ cwd: "/repo", datasetId: "mimic-iv" });

      expect(result.ok).toBe(true);
    }).pipe(Effect.provide(makeLayer())),
  );

  it.effect("reports missing retained terminal event after truncated NDJSON", () =>
    Effect.gen(function* () {
      mockRun.mockReturnValueOnce(
        Effect.succeed(
          processOutput(
            // @effect-diagnostics-next-line preferSchemaOverJson:off
            JSON.stringify({
              version: 1,
              sequence: 120,
              event: "progress",
              message: "still working",
            }),
            0,
            "",
            true,
          ),
        ),
      );

      const m4 = yield* M4Cli;
      const result = yield* Effect.result(m4.initialize({ cwd: "/repo", datasetId: "mimic-iv" }));

      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure.code).toBe("invalid_m4_status");
        expect(result.failure.detail).toContain("terminal event");
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
