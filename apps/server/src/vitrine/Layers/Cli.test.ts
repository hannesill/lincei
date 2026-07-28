import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Path from "effect/Path";
import { ChildProcessSpawner } from "effect/unstable/process";
import { vi } from "vitest";

import {
  ProcessRunner,
  ProcessSpawnError,
  ProcessTimeoutError,
  type ProcessRunOutput,
  type ProcessRunnerShape,
} from "../../processRunner.ts";
import { VitrineCliError } from "../Services/Cli.ts";
import {
  makeVitrineExecutableResolver,
  makeVitrineCli,
  resolveVitrineExecutable,
  VitrineExecutableResolutionError,
} from "./Cli.ts";

const WORKSPACE_ROOT = "/workspace/project-a";
const DATA_DIR = `${WORKSPACE_ROOT}/.vitrine`;

function output(stdout: unknown, code = 0): ProcessRunOutput {
  return {
    stdout: typeof stdout === "string" ? stdout : JSON.stringify(stdout),
    stderr: "",
    code: ChildProcessSpawner.ExitCode(code),
    timedOut: false,
    stdoutTruncated: false,
    stderrTruncated: false,
  };
}

function runningPayload(overrides: Record<string, unknown> = {}) {
  return {
    status: "running",
    url: "http://vitrine.localhost:7741",
    api_url: "http://127.0.0.1:7741",
    pid: 1234,
    port: 7741,
    session_id: "session-a",
    data_dir: DATA_DIR,
    version: "0.1.1",
    lifecycle_contract_version: 1,
    ...overrides,
  };
}

it.layer(NodeServices.layer)("VitrineCli", (it) => {
  it.effect("starts with argument arrays, project cwd, and an explicit data directory", () =>
    Effect.gen(function* () {
      const run = vi.fn<ProcessRunnerShape["run"]>(() => Effect.succeed(output(runningPayload())));
      const path = yield* Path.Path;
      const cli = makeVitrineCli({
        path,
        processRunner: ProcessRunner.of({ run }),
        resolveExecutable: () =>
          Effect.succeed({
            executable: "/opt/vitrine/bin/vitrine",
            source: "settings",
          }),
      });

      const snapshot = yield* cli.run("start", { workspaceRoot: WORKSPACE_ROOT });

      expect(snapshot.status).toBe("running");
      expect(run).toHaveBeenCalledWith(
        expect.objectContaining({
          command: "/opt/vitrine/bin/vitrine",
          args: ["start", "--no-open", "--json"],
          cwd: WORKSPACE_ROOT,
          env: { VITRINE_DATA_DIR: DATA_DIR },
          shell: false,
        }),
      );
      const startInput = run.mock.calls[0]?.[0];
      expect(Duration.toMillis(startInput?.timeout ?? 0)).toBe(40_000);
    }),
  );

  it.effect("accepts the stable stopped status and exit code", () =>
    Effect.gen(function* () {
      const run = vi.fn<ProcessRunnerShape["run"]>(() =>
        Effect.succeed(
          output(
            {
              status: "stopped",
              url: null,
              api_url: null,
              pid: null,
              port: null,
              session_id: null,
              data_dir: DATA_DIR,
              version: "0.1.1",
              lifecycle_contract_version: 1,
            },
            3,
          ),
        ),
      );
      const path = yield* Path.Path;
      const cli = makeVitrineCli({ path, processRunner: ProcessRunner.of({ run }) });

      const snapshot = yield* cli.run("status", { workspaceRoot: WORKSPACE_ROOT });

      expect(snapshot).toEqual({ status: "stopped", dataDir: DATA_DIR, version: "0.1.1" });
    }),
  );

  it.effect("reports an unavailable executable", () =>
    Effect.gen(function* () {
      const run = vi.fn<ProcessRunnerShape["run"]>((input) =>
        Effect.fail(
          new ProcessSpawnError({
            command: input.command,
            args: input.args,
            cwd: input.cwd,
            cause: new Error("ENOENT"),
          }),
        ),
      );
      const path = yield* Path.Path;
      const cli = makeVitrineCli({ path, processRunner: ProcessRunner.of({ run }) });

      const error = yield* cli.run("status", { workspaceRoot: WORKSPACE_ROOT }).pipe(Effect.flip);

      expect(error).toBeInstanceOf(VitrineCliError);
      expect(error.code).toBe("executable_unavailable");
      expect(error.detail).toContain("using the backend PATH");
      expect(error.detail).toContain("configure its executable path in Settings");
    }),
  );

  it.effect("reports lifecycle command timeouts", () =>
    Effect.gen(function* () {
      const run = vi.fn<ProcessRunnerShape["run"]>((input) =>
        Effect.fail(
          new ProcessTimeoutError({
            command: input.command,
            args: input.args,
            cwd: input.cwd,
            timeoutMs: 10_000,
          }),
        ),
      );
      const path = yield* Path.Path;
      const cli = makeVitrineCli({ path, processRunner: ProcessRunner.of({ run }) });

      const error = yield* cli.run("start", { workspaceRoot: WORKSPACE_ROOT }).pipe(Effect.flip);

      expect(error.code).toBe("startup_timeout");
    }),
  );

  it.effect("rejects another project's data directory", () =>
    Effect.gen(function* () {
      const run = vi.fn<ProcessRunnerShape["run"]>(() =>
        Effect.succeed(output(runningPayload({ data_dir: "/workspace/project-b/.vitrine" }))),
      );
      const path = yield* Path.Path;
      const cli = makeVitrineCli({ path, processRunner: ProcessRunner.of({ run }) });

      const error = yield* cli.run("status", { workspaceRoot: WORKSPACE_ROOT }).pipe(Effect.flip);

      expect(error.code).toBe("project_mismatch");
    }),
  );

  it.effect("rejects non-loopback and malformed preview URLs", () =>
    Effect.gen(function* () {
      const run = vi.fn<ProcessRunnerShape["run"]>(() =>
        Effect.succeed(output(runningPayload({ url: "https://example.com:7741" }))),
      );
      const path = yield* Path.Path;
      const cli = makeVitrineCli({ path, processRunner: ProcessRunner.of({ run }) });

      const error = yield* cli.run("status", { workspaceRoot: WORKSPACE_ROOT }).pipe(Effect.flip);

      expect(error.code).toBe("non_loopback_url");
    }),
  );

  it.effect("rejects loopback URLs with unexpected credentials or paths", () =>
    Effect.gen(function* () {
      const run = vi.fn<ProcessRunnerShape["run"]>(() =>
        Effect.succeed(output(runningPayload({ url: "http://user@vitrine.localhost:7741/other" }))),
      );
      const path = yield* Path.Path;
      const cli = makeVitrineCli({ path, processRunner: ProcessRunner.of({ run }) });

      const error = yield* cli.run("status", { workspaceRoot: WORKSPACE_ROOT }).pipe(Effect.flip);

      expect(error.code).toBe("non_loopback_url");
    }),
  );

  it.effect("rejects incompatible versions", () =>
    Effect.gen(function* () {
      const run = vi.fn<ProcessRunnerShape["run"]>(() =>
        Effect.succeed(output(runningPayload({ version: "0.2.0" }))),
      );
      const path = yield* Path.Path;
      const cli = makeVitrineCli({ path, processRunner: ProcessRunner.of({ run }) });

      const error = yield* cli.run("status", { workspaceRoot: WORKSPACE_ROOT }).pipe(Effect.flip);

      expect(error.code).toBe("incompatible_version");
    }),
  );

  it.effect("rejects versions below the lifecycle contract release", () =>
    Effect.gen(function* () {
      const run = vi.fn<ProcessRunnerShape["run"]>(() =>
        Effect.succeed(output(runningPayload({ version: "0.1.0" }))),
      );
      const path = yield* Path.Path;
      const cli = makeVitrineCli({ path, processRunner: ProcessRunner.of({ run }) });

      const error = yield* cli.run("status", { workspaceRoot: WORKSPACE_ROOT }).pipe(Effect.flip);

      expect(error.code).toBe("incompatible_version");
      expect(error.detail).toContain(">=0.1.1 <0.2.0");
    }),
  );

  it.effect("requires lifecycle contract 1 in every lifecycle payload", () =>
    Effect.gen(function* () {
      const run = vi.fn<ProcessRunnerShape["run"]>(() =>
        Effect.succeed(
          output(
            runningPayload({
              lifecycle_contract_version: 2,
            }),
          ),
        ),
      );
      const path = yield* Path.Path;
      const cli = makeVitrineCli({ path, processRunner: ProcessRunner.of({ run }) });

      const error = yield* cli.run("status", { workspaceRoot: WORKSPACE_ROOT }).pipe(Effect.flip);

      expect(error.code).toBe("invalid_status_payload");
    }),
  );

  it.effect("requires a compatible version in stopped and failed lifecycle payloads", () =>
    Effect.gen(function* () {
      const responses = [
        output(
          {
            status: "stopped",
            data_dir: DATA_DIR,
            lifecycle_contract_version: 1,
          },
          3,
        ),
        output(
          {
            status: "stopped",
            data_dir: DATA_DIR,
            version: "0.1.0",
            lifecycle_contract_version: 1,
          },
          3,
        ),
        output(
          {
            status: "failed",
            data_dir: DATA_DIR,
            version: "unknown",
            lifecycle_contract_version: 1,
            error: "Legacy daemon\n`restart required`",
          },
          1,
        ),
      ];
      const run = vi.fn<ProcessRunnerShape["run"]>(() => Effect.succeed(responses.shift()!));
      const path = yield* Path.Path;
      const cli = makeVitrineCli({ path, processRunner: ProcessRunner.of({ run }) });

      const missingVersion = yield* cli
        .run("status", { workspaceRoot: WORKSPACE_ROOT })
        .pipe(Effect.flip);
      const stoppedOldVersion = yield* cli
        .run("status", { workspaceRoot: WORKSPACE_ROOT })
        .pipe(Effect.flip);
      const failedUnknownVersion = yield* cli
        .run("status", { workspaceRoot: WORKSPACE_ROOT })
        .pipe(Effect.flip);

      expect(missingVersion.code).toBe("invalid_status_payload");
      expect(stoppedOldVersion.code).toBe("incompatible_version");
      expect(failedUnknownVersion.code).toBe("incompatible_version");
      expect(failedUnknownVersion.detail).toContain(
        "Vitrine reported: Legacy daemon 'restart required'",
      );
      expect(failedUnknownVersion.detail).not.toContain("\n");
      expect(failedUnknownVersion.detail).not.toContain("`restart");
    }),
  );

  it.effect("bounds and sanitizes lifecycle failure text before exposing it", () =>
    Effect.gen(function* () {
      const rawFailure = `child failed\n\`spoofed message\` ${"x".repeat(2_000)}`;
      const run = vi.fn<ProcessRunnerShape["run"]>(() =>
        Effect.succeed(
          output(
            {
              status: "failed",
              data_dir: DATA_DIR,
              version: "0.1.1",
              lifecycle_contract_version: 1,
              error: rawFailure,
            },
            1,
          ),
        ),
      );
      const path = yield* Path.Path;
      const cli = makeVitrineCli({ path, processRunner: ProcessRunner.of({ run }) });

      const error = yield* cli.run("status", { workspaceRoot: WORKSPACE_ROOT }).pipe(Effect.flip);

      expect(error.code).toBe("command_failed");
      expect(error.detail.length).toBeLessThanOrEqual(1_024);
      expect(error.detail).not.toContain("\n");
      expect(error.detail).not.toContain("`");
      expect(error.detail).toContain("'spoofed message'");
    }),
  );

  it.effect("rejects invalid process identity metadata", () =>
    Effect.gen(function* () {
      const run = vi.fn<ProcessRunnerShape["run"]>(() =>
        Effect.succeed(output(runningPayload({ pid: -1 }))),
      );
      const path = yield* Path.Path;
      const cli = makeVitrineCli({ path, processRunner: ProcessRunner.of({ run }) });

      const error = yield* cli.run("status", { workspaceRoot: WORKSPACE_ROOT }).pipe(Effect.flip);

      expect(error.code).toBe("invalid_status_payload");
    }),
  );

  it.effect("rejects malformed JSON and early start exits", () =>
    Effect.gen(function* () {
      const malformedRun = vi.fn<ProcessRunnerShape["run"]>(() =>
        Effect.succeed(output("not-json")),
      );
      const malformedCli = makeVitrineCli({
        path: yield* Path.Path,
        processRunner: ProcessRunner.of({ run: malformedRun }),
      });
      const malformed = yield* malformedCli
        .run("status", { workspaceRoot: WORKSPACE_ROOT })
        .pipe(Effect.flip);
      expect(malformed.code).toBe("invalid_status_payload");

      const exitedRun = vi.fn<ProcessRunnerShape["run"]>(() =>
        Effect.succeed(
          output(
            {
              status: "failed",
              data_dir: DATA_DIR,
              version: "0.1.1",
              error: "child exited",
              lifecycle_contract_version: 1,
            },
            1,
          ),
        ),
      );
      const exitedCli = makeVitrineCli({
        path: yield* Path.Path,
        processRunner: ProcessRunner.of({ run: exitedRun }),
      });
      const exited = yield* exitedCli
        .run("start", { workspaceRoot: WORKSPACE_ROOT })
        .pipe(Effect.flip);
      expect(exited.code).toBe("process_exited");

      const emptyExitRun = vi.fn<ProcessRunnerShape["run"]>(() => Effect.succeed(output("", 7)));
      const emptyExitCli = makeVitrineCli({
        path: yield* Path.Path,
        processRunner: ProcessRunner.of({ run: emptyExitRun }),
      });
      const emptyExit = yield* emptyExitCli
        .run("start", { workspaceRoot: WORKSPACE_ROOT })
        .pipe(Effect.flip);
      expect(emptyExit.code).toBe("process_exited");
    }),
  );

  it.effect("resolves the executable for every operation", () =>
    Effect.gen(function* () {
      const run = vi.fn<ProcessRunnerShape["run"]>(() => Effect.succeed(output(runningPayload())));
      const path = yield* Path.Path;
      let executable = "/first/vitrine";
      const cli = makeVitrineCli({
        path,
        processRunner: ProcessRunner.of({ run }),
        resolveExecutable: () =>
          Effect.succeed({
            executable,
            source: "settings",
          }),
      });

      yield* cli.run("status", { workspaceRoot: WORKSPACE_ROOT });
      executable = "/second/vitrine";
      yield* cli.run("status", { workspaceRoot: WORKSPACE_ROOT });

      expect(run.mock.calls.map(([input]) => input.command)).toEqual([
        "/first/vitrine",
        "/second/vitrine",
      ]);
    }),
  );

  it("resolves environment before settings, expands home paths, then falls back to PATH", () => {
    const environment = resolveVitrineExecutable({
      environmentExecutable: "~/env/vitrine",
      settingsExecutable: "/settings/vitrine",
    });
    const settings = resolveVitrineExecutable({
      environmentExecutable: " ",
      settingsExecutable: "~/settings/vitrine",
    });
    const path = resolveVitrineExecutable({});

    expect(environment.source).toBe("environment");
    expect(environment.executable).not.toContain("~");
    expect(environment.executable).toMatch(/[/\\]env[/\\]vitrine$/);
    expect(settings.source).toBe("settings");
    expect(settings.executable).not.toContain("~");
    expect(settings.executable).toMatch(/[/\\]settings[/\\]vitrine$/);
    expect(path).toEqual({ executable: "vitrine", source: "path" });
  });

  it("accepts bare or absolute executables and rejects path-like relative values", () => {
    expect(
      resolveVitrineExecutable({
        settingsExecutable: "vitrine-preview",
      }),
    ).toEqual({
      executable: "vitrine-preview",
      source: "settings",
    });
    expect(
      resolveVitrineExecutable({
        settingsExecutable: "/opt/vitrine/bin/vitrine",
      }),
    ).toEqual({
      executable: "/opt/vitrine/bin/vitrine",
      source: "settings",
    });
    expect(
      resolveVitrineExecutable({
        settingsExecutable: "C:\\Vitrine\\Scripts\\vitrine.exe",
      }),
    ).toEqual({
      executable: "C:\\Vitrine\\Scripts\\vitrine.exe",
      source: "settings",
    });

    for (const executable of [
      "./.venv/bin/vitrine",
      "../bin/vitrine",
      ".\\Scripts\\vitrine.exe",
      "C:vitrine.exe",
      "python -m vitrine",
    ]) {
      expect(() =>
        resolveVitrineExecutable({
          settingsExecutable: executable,
        }),
      ).toThrow(VitrineExecutableResolutionError);
    }
  });

  it.effect("does not read settings when the fixed environment override is present", () =>
    Effect.gen(function* () {
      const readSettingsExecutable = vi.fn(() =>
        Effect.fail(
          new VitrineExecutableResolutionError({
            cause: new Error("settings unavailable"),
          }),
        ),
      );
      const resolveExecutable = makeVitrineExecutableResolver({
        environmentExecutable: "/env/vitrine",
        readSettingsExecutable,
      });

      const resolution = yield* resolveExecutable();

      expect(resolution).toEqual({
        executable: "/env/vitrine",
        source: "environment",
      });
      expect(readSettingsExecutable).not.toHaveBeenCalled();
    }),
  );

  it.effect("reports an invalid configured executable without spawning a process", () =>
    Effect.gen(function* () {
      const run = vi.fn<ProcessRunnerShape["run"]>(() => Effect.succeed(output(runningPayload())));
      const path = yield* Path.Path;
      const cli = makeVitrineCli({
        path,
        processRunner: ProcessRunner.of({ run }),
        resolveExecutable: makeVitrineExecutableResolver({
          readSettingsExecutable: () => Effect.succeed("./.venv/bin/vitrine"),
        }),
      });

      const status = yield* cli.runtimeStatus;
      const lifecycleError = yield* cli
        .run("status", { workspaceRoot: WORKSPACE_ROOT })
        .pipe(Effect.flip);

      expect(status.status).toBe("unavailable");
      expect(status.source).toBe("settings");
      expect(status.executable).toBe("./.venv/bin/vitrine");
      expect(status.message).toContain("bare command name");
      expect(status.message).toContain("absolute executable path");
      expect(lifecycleError.code).toBe("executable_unavailable");
      expect(lifecycleError.detail).toBe(status.message);
      expect(run).not.toHaveBeenCalled();
    }),
  );

  it.effect("reports a ready runtime from Vitrine doctor", () =>
    Effect.gen(function* () {
      const run = vi.fn<ProcessRunnerShape["run"]>(() =>
        Effect.succeed(
          output({
            status: "ok",
            version: "0.1.1",
            lifecycle_contract_version: 1,
            python_executable: "/venv/bin/python",
          }),
        ),
      );
      const path = yield* Path.Path;
      const cli = makeVitrineCli({
        path,
        processRunner: ProcessRunner.of({ run }),
        resolveExecutable: () =>
          Effect.succeed({
            executable: "/configured/vitrine",
            source: "settings",
          }),
      });

      const status = yield* cli.runtimeStatus;

      expect(status).toMatchObject({
        status: "ready",
        source: "settings",
        executable: "/configured/vitrine",
        version: "0.1.1",
        lifecycleContractVersion: 1,
        pythonExecutable: "/venv/bin/python",
        supportedVersionRange: ">=0.1.1 <0.2.0",
        requiredLifecycleContractVersion: 1,
        message: null,
      });
      expect(run).toHaveBeenCalledWith(
        expect.objectContaining({
          command: "/configured/vitrine",
          args: ["doctor", "--json"],
          shell: false,
        }),
      );
      const doctorInput = run.mock.calls[0]?.[0];
      expect(Duration.toMillis(doctorInput?.timeout ?? 0)).toBe(10_000);
    }),
  );

  it.effect("reports incompatible doctor versions and lifecycle contracts", () =>
    Effect.gen(function* () {
      const responses = [
        output({
          status: "ok",
          version: "0.1.0",
          lifecycle_contract_version: 1,
          python_executable: "/venv/bin/python",
        }),
        output({
          status: "ok",
          version: "0.1.1",
          lifecycle_contract_version: 2,
          python_executable: "/venv/bin/python",
        }),
      ];
      const run = vi.fn<ProcessRunnerShape["run"]>(() => Effect.succeed(responses.shift()!));
      const path = yield* Path.Path;
      const cli = makeVitrineCli({ path, processRunner: ProcessRunner.of({ run }) });

      const oldVersion = yield* cli.runtimeStatus;
      const wrongContract = yield* cli.runtimeStatus;

      expect(oldVersion.status).toBe("incompatible");
      expect(oldVersion.message).toContain(">=0.1.1 <0.2.0");
      expect(wrongContract.status).toBe("incompatible");
      expect(wrongContract.message).toContain("lifecycle contract 2");
    }),
  );

  it.effect("sanitizes and bounds doctor fields before returning runtime status", () =>
    Effect.gen(function* () {
      const responses = [
        output({
          status: "ok",
          version: "0.1.1",
          lifecycle_contract_version: 1,
          python_executable: "/venv/\n`python`",
        }),
        output({
          status: "ok",
          version: "0.1.0\n`spoofed version`",
          lifecycle_contract_version: 1,
          python_executable: `/venv/${"x".repeat(2_000)}`,
        }),
      ];
      const run = vi.fn<ProcessRunnerShape["run"]>(() => Effect.succeed(responses.shift()!));
      const path = yield* Path.Path;
      const cli = makeVitrineCli({ path, processRunner: ProcessRunner.of({ run }) });

      const ready = yield* cli.runtimeStatus;
      const incompatible = yield* cli.runtimeStatus;

      expect(ready.status).toBe("ready");
      expect(ready.pythonExecutable).toBe("/venv/ 'python'");
      expect(incompatible.status).toBe("incompatible");
      expect(incompatible.version).toBe("0.1.0 'spoofed version'");
      expect(incompatible.pythonExecutable?.length).toBeLessThanOrEqual(1_024);
      expect(incompatible.message).not.toContain("\n");
      expect(incompatible.message).not.toContain("`spoofed version`");
    }),
  );

  it.effect("returns a sanitized source-aware status when the doctor cannot spawn", () =>
    Effect.gen(function* () {
      const run = vi.fn<ProcessRunnerShape["run"]>((input) =>
        Effect.fail(
          new ProcessSpawnError({
            command: input.command,
            args: input.args,
            cwd: input.cwd,
            cause: new Error("secret raw spawn failure"),
          }),
        ),
      );
      const path = yield* Path.Path;
      const cli = makeVitrineCli({
        path,
        processRunner: ProcessRunner.of({ run }),
        resolveExecutable: () =>
          Effect.succeed({
            executable: "/bad/`vitrine\npath",
            source: "environment",
          }),
      });

      const status = yield* cli.runtimeStatus;

      expect(status.status).toBe("unavailable");
      expect(status.source).toBe("environment");
      expect(status.message).toContain("from LINCEI_VITRINE_EXECUTABLE");
      expect(status.message).toContain("Fix or unset LINCEI_VITRINE_EXECUTABLE");
      expect(status.message).not.toContain("secret raw spawn failure");
      expect(status.message).not.toContain("\n");
      expect(status.message).not.toContain("`vitrine");
    }),
  );

  it.effect("returns a failed public status for resolver and invalid doctor failures", () =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const unusedRun = vi.fn<ProcessRunnerShape["run"]>(() => Effect.succeed(output("not-json")));
      const resolverFailure = makeVitrineCli({
        path,
        processRunner: ProcessRunner.of({ run: unusedRun }),
        resolveExecutable: () =>
          Effect.fail(
            new VitrineExecutableResolutionError({
              cause: new Error("private settings failure"),
            }),
          ),
      });

      const resolverStatus = yield* resolverFailure.runtimeStatus;
      expect(resolverStatus.status).toBe("failed");
      expect(resolverStatus.message).not.toContain("private settings failure");
      expect(unusedRun).not.toHaveBeenCalled();

      const invalidDoctor = makeVitrineCli({
        path,
        processRunner: ProcessRunner.of({
          run: () => Effect.succeed(output("not-json")),
        }),
      });
      const doctorStatus = yield* invalidDoctor.runtimeStatus;
      expect(doctorStatus.status).toBe("failed");
      expect(doctorStatus.message).toContain("invalid JSON");
    }),
  );
});
