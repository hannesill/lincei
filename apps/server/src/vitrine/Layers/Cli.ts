import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { satisfiesSemverRange } from "@t3tools/shared/semver";

import {
  ProcessRunner,
  ProcessSpawnError,
  ProcessTimeoutError,
  type ProcessRunnerShape,
} from "../../processRunner.ts";
import {
  VitrineCli,
  VitrineCliError,
  type VitrineCliAction,
  type VitrineCliShape,
  type VitrineCliSnapshot,
} from "../Services/Cli.ts";

export const VITRINE_SUPPORTED_VERSION_RANGE = ">=0.1.0 <0.2.0";
const DEFAULT_VITRINE_EXECUTABLE = "vitrine";
const MAX_OUTPUT_BYTES = 64 * 1024;
const COMMAND_TIMEOUT = Duration.seconds(10);
const NOT_RUNNING_EXIT_CODE = 3;

const NullableString = Schema.optional(Schema.NullOr(Schema.String));
const NullableInt = Schema.optional(Schema.NullOr(Schema.Int));

const RunningPayload = Schema.Struct({
  status: Schema.Literal("running"),
  url: Schema.String,
  api_url: Schema.String,
  pid: Schema.Int,
  port: Schema.Int,
  session_id: Schema.String,
  data_dir: Schema.String,
  version: Schema.String,
});

const StoppedPayload = Schema.Struct({
  status: Schema.Literal("stopped"),
  url: NullableString,
  api_url: NullableString,
  pid: NullableInt,
  port: NullableInt,
  session_id: NullableString,
  data_dir: Schema.String,
  version: Schema.optional(Schema.NullOr(Schema.String)),
});

const FailedPayload = Schema.Struct({
  status: Schema.Literal("failed"),
  data_dir: Schema.optional(Schema.String),
  version: Schema.optional(Schema.NullOr(Schema.String)),
  error: Schema.optional(Schema.String),
  message: Schema.optional(Schema.String),
});

const LifecyclePayload = Schema.Union([RunningPayload, StoppedPayload, FailedPayload]);
const decodeLifecyclePayload = Schema.decodeUnknownSync(LifecyclePayload);

function cliError(input: {
  readonly action: VitrineCliAction;
  readonly code: ConstructorParameters<typeof VitrineCliError>[0]["code"];
  readonly detail: string;
  readonly cause?: unknown;
}): VitrineCliError {
  return new VitrineCliError(input);
}

function commandArgs(action: VitrineCliAction): ReadonlyArray<string> {
  switch (action) {
    case "start":
      return ["start", "--no-open", "--json"];
    case "status":
      return ["status", "--json"];
    case "stop":
      return ["stop", "--json"];
  }
}

function expectedDataDir(path: Path.Path, workspaceRoot: string): string {
  return path.resolve(workspaceRoot, ".vitrine");
}

function parseLifecyclePayload(action: VitrineCliAction, stdout: string) {
  const trimmed = stdout.trim();
  if (trimmed.length === 0) {
    throw cliError({
      action,
      code: "invalid_status_payload",
      detail: "Vitrine returned an empty lifecycle response.",
    });
  }

  let json: unknown;
  try {
    json = JSON.parse(trimmed);
  } catch (cause) {
    throw cliError({
      action,
      code: "invalid_status_payload",
      detail: "Vitrine returned malformed lifecycle JSON.",
      cause,
    });
  }

  try {
    return decodeLifecyclePayload(json);
  } catch (cause) {
    throw cliError({
      action,
      code: "invalid_status_payload",
      detail: "Vitrine returned an incompatible lifecycle payload.",
      cause,
    });
  }
}

function validateDataDir(
  action: VitrineCliAction,
  path: Path.Path,
  workspaceRoot: string,
  actualDataDir: string,
): string {
  const expected = expectedDataDir(path, workspaceRoot);
  const actual = path.resolve(actualDataDir);
  if (actual !== expected) {
    throw cliError({
      action,
      code: "project_mismatch",
      detail: `Vitrine reported data directory ${actual}; expected ${expected}.`,
    });
  }
  return expected;
}

function parseLoopbackUrl(
  action: VitrineCliAction,
  rawUrl: string,
  allowedHosts: ReadonlySet<string>,
  expectedPort: number,
  label: string,
): string {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch (cause) {
    throw cliError({
      action,
      code: "non_loopback_url",
      detail: `Vitrine reported a malformed ${label} URL.`,
      cause,
    });
  }
  if (
    url.protocol !== "http:" ||
    !allowedHosts.has(url.hostname) ||
    Number.parseInt(url.port, 10) !== expectedPort ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw cliError({
      action,
      code: "non_loopback_url",
      detail: `Vitrine reported an unexpected ${label} URL.`,
    });
  }
  return url.href;
}

function validateVersion(action: VitrineCliAction, version: string): string {
  if (!satisfiesSemverRange(version, VITRINE_SUPPORTED_VERSION_RANGE)) {
    throw cliError({
      action,
      code: "incompatible_version",
      detail: `Vitrine ${version} is incompatible; expected ${VITRINE_SUPPORTED_VERSION_RANGE}.`,
    });
  }
  return version;
}

function toSnapshot(input: {
  readonly action: VitrineCliAction;
  readonly path: Path.Path;
  readonly workspaceRoot: string;
  readonly stdout: string;
  readonly exitCode: number | null;
}): VitrineCliSnapshot {
  let payload: typeof LifecyclePayload.Type;
  try {
    payload = parseLifecyclePayload(input.action, input.stdout);
  } catch (cause) {
    if (input.action === "start" && input.exitCode !== 0) {
      throw cliError({
        action: input.action,
        code: "process_exited",
        detail: `Vitrine exited before reporting readiness (code ${input.exitCode ?? "unknown"}).`,
        cause,
      });
    }
    throw cause;
  }
  if (payload.status === "failed") {
    throw cliError({
      action: input.action,
      code: input.action === "start" ? "process_exited" : "command_failed",
      detail: payload.message ?? payload.error ?? "Vitrine lifecycle command failed.",
    });
  }

  const dataDir = validateDataDir(input.action, input.path, input.workspaceRoot, payload.data_dir);
  if (payload.status === "stopped") {
    if (input.action === "start") {
      throw cliError({
        action: input.action,
        code: "process_exited",
        detail: "Vitrine start completed without a running server.",
      });
    }
    if (input.exitCode !== 0 && input.exitCode !== NOT_RUNNING_EXIT_CODE) {
      throw cliError({
        action: input.action,
        code: "command_failed",
        detail: `Vitrine exited with code ${input.exitCode ?? "unknown"}.`,
      });
    }
    const version = payload.version ? validateVersion(input.action, payload.version) : null;
    return { status: "stopped", dataDir, version };
  }

  if (input.exitCode !== 0) {
    throw cliError({
      action: input.action,
      code: input.action === "start" ? "process_exited" : "command_failed",
      detail: `Vitrine exited with code ${input.exitCode ?? "unknown"}.`,
    });
  }
  if (input.action === "stop") {
    throw cliError({
      action: input.action,
      code: "invalid_status_payload",
      detail: "Vitrine stop reported a running server.",
    });
  }
  if (
    payload.pid <= 0 ||
    payload.port <= 0 ||
    payload.port >= 65_536 ||
    payload.session_id.trim().length === 0
  ) {
    throw cliError({
      action: input.action,
      code: "invalid_status_payload",
      detail: "Vitrine returned invalid process identity metadata.",
    });
  }

  const version = validateVersion(input.action, payload.version);
  const url = parseLoopbackUrl(
    input.action,
    payload.url,
    new Set(["vitrine.localhost", "localhost", "127.0.0.1", "[::1]"]),
    payload.port,
    "browser",
  );
  const apiUrl = parseLoopbackUrl(
    input.action,
    payload.api_url,
    new Set(["localhost", "127.0.0.1", "[::1]"]),
    payload.port,
    "API",
  );
  return {
    status: "running",
    url,
    apiUrl,
    pid: payload.pid,
    port: payload.port,
    sessionId: payload.session_id,
    dataDir,
    version,
  };
}

export function makeVitrineCli(input: {
  readonly path: Path.Path;
  readonly processRunner: ProcessRunnerShape;
  readonly executable?: string | undefined;
}): VitrineCliShape {
  const executable = input.executable?.trim() || DEFAULT_VITRINE_EXECUTABLE;

  const run: VitrineCliShape["run"] = (action, cliInput) =>
    input.processRunner
      .run({
        command: executable,
        args: commandArgs(action),
        cwd: cliInput.workspaceRoot,
        env: { VITRINE_DATA_DIR: expectedDataDir(input.path, cliInput.workspaceRoot) },
        shell: false,
        timeout: COMMAND_TIMEOUT,
        maxOutputBytes: MAX_OUTPUT_BYTES,
      })
      .pipe(
        Effect.mapError((cause) =>
          cliError({
            action,
            code:
              cause instanceof ProcessSpawnError
                ? "executable_unavailable"
                : cause instanceof ProcessTimeoutError
                  ? "startup_timeout"
                  : "command_failed",
            detail:
              cause instanceof ProcessSpawnError
                ? `Vitrine executable '${executable}' is unavailable.`
                : cause instanceof ProcessTimeoutError
                  ? `Vitrine ${action} timed out.`
                  : `Vitrine ${action} failed.`,
            cause,
          }),
        ),
        Effect.flatMap((output) =>
          Effect.try({
            try: () =>
              toSnapshot({
                action,
                path: input.path,
                workspaceRoot: cliInput.workspaceRoot,
                stdout: output.stdout,
                exitCode: output.code,
              }),
            catch: (cause) =>
              cause instanceof VitrineCliError
                ? cause
                : cliError({
                    action,
                    code: "invalid_status_payload",
                    detail: "Vitrine lifecycle response validation failed.",
                    cause,
                  }),
          }),
        ),
      );

  return VitrineCli.of({ run });
}

export const VitrineCliLive = Layer.effect(
  VitrineCli,
  Effect.gen(function* () {
    const path = yield* Path.Path;
    const processRunner = yield* ProcessRunner;
    return makeVitrineCli({
      path,
      processRunner,
      executable: process.env.LINCEI_VITRINE_EXECUTABLE,
    });
  }),
);
