import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
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
import { makeVitrineCli } from "./Cli.ts";

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
    version: "0.1.0",
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
        executable: "/opt/vitrine/bin/vitrine",
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
              version: "0.1.0",
            },
            3,
          ),
        ),
      );
      const path = yield* Path.Path;
      const cli = makeVitrineCli({ path, processRunner: ProcessRunner.of({ run }) });

      const snapshot = yield* cli.run("status", { workspaceRoot: WORKSPACE_ROOT });

      expect(snapshot).toEqual({ status: "stopped", dataDir: DATA_DIR, version: "0.1.0" });
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
              version: "0.1.0",
              error: "child exited",
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
    }),
  );
});
