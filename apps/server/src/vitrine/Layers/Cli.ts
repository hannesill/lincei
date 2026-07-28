import type { VitrineRuntimeSource, VitrineRuntimeStatus } from "@t3tools/contracts";
import * as Data from "effect/Data";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { satisfiesSemverRange } from "@t3tools/shared/semver";

import { expandHomePath } from "../../pathExpansion.ts";
import {
  ProcessRunner,
  ProcessSpawnError,
  ProcessTimeoutError,
  type ProcessRunError,
  type ProcessRunOutput,
  type ProcessRunnerShape,
} from "../../processRunner.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import {
  VitrineCli,
  VitrineCliError,
  type VitrineCliAction,
  type VitrineCliShape,
  type VitrineCliSnapshot,
} from "../Services/Cli.ts";

export const VITRINE_SUPPORTED_VERSION_RANGE = ">=0.1.1 <0.2.0";
export const VITRINE_REQUIRED_LIFECYCLE_CONTRACT_VERSION = 1;
const DEFAULT_VITRINE_EXECUTABLE = "vitrine";
const MAX_OUTPUT_BYTES = 64 * 1024;
const START_TIMEOUT = Duration.seconds(40);
const COMMAND_TIMEOUT = Duration.seconds(10);
const NOT_RUNNING_EXIT_CODE = 3;
const MAX_PUBLIC_VERSION_LENGTH = 128;
const MAX_PUBLIC_PATH_LENGTH = 1_024;
const MAX_PUBLIC_MESSAGE_LENGTH = 1_024;
const MAX_PUBLIC_SESSION_ID_LENGTH = 128;

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
  lifecycle_contract_version: Schema.Literal(VITRINE_REQUIRED_LIFECYCLE_CONTRACT_VERSION),
});

const StoppedPayload = Schema.Struct({
  status: Schema.Literal("stopped"),
  url: NullableString,
  api_url: NullableString,
  pid: NullableInt,
  port: NullableInt,
  session_id: NullableString,
  data_dir: Schema.String,
  version: Schema.String,
  lifecycle_contract_version: Schema.Literal(VITRINE_REQUIRED_LIFECYCLE_CONTRACT_VERSION),
});

const FailedPayload = Schema.Struct({
  status: Schema.Literal("failed"),
  data_dir: Schema.String,
  version: Schema.String,
  error: Schema.optional(Schema.String),
  message: Schema.optional(Schema.String),
  lifecycle_contract_version: Schema.Literal(VITRINE_REQUIRED_LIFECYCLE_CONTRACT_VERSION),
});

const LifecyclePayload = Schema.Union([RunningPayload, StoppedPayload, FailedPayload]);
const decodeLifecyclePayload = Schema.decodeUnknownSync(LifecyclePayload);

const DoctorPayload = Schema.Struct({
  status: Schema.Literal("ok"),
  version: Schema.String,
  lifecycle_contract_version: Schema.Int.check(Schema.isGreaterThan(0)),
  python_executable: Schema.String,
});
const decodeDoctorPayload = Schema.decodeUnknownSync(DoctorPayload);

export interface VitrineExecutableResolution {
  readonly executable: string;
  readonly source: VitrineRuntimeSource;
}

export class VitrineExecutableResolutionError extends Data.TaggedError(
  "VitrineExecutableResolutionError",
)<{
  readonly cause: unknown;
  readonly detail?: string | undefined;
  readonly executable?: string | undefined;
  readonly source?: VitrineRuntimeSource | undefined;
}> {}

function isControlCharacter(character: string): boolean {
  const codePoint = character.codePointAt(0) ?? 0;
  return (
    codePoint <= 0x1f ||
    (codePoint >= 0x7f && codePoint <= 0x9f) ||
    codePoint === 0x2028 ||
    codePoint === 0x2029
  );
}

function sanitizePublicText(value: string, maxLength: number): string {
  const withoutControlCharacters = Array.from(value, (character) =>
    isControlCharacter(character) ? " " : character,
  ).join("");
  const sanitized = withoutControlCharacters.replace(/\s+/gu, " ").trim().replaceAll("`", "'");
  const characters = Array.from(sanitized);
  return characters.length > maxLength
    ? `${characters.slice(0, maxLength - 1).join("")}…`
    : sanitized;
}

function isAbsoluteExecutablePath(value: string): boolean {
  return value.startsWith("/") || value.startsWith("\\\\") || /^[A-Za-z]:[\\/]/u.test(value);
}

function isBareExecutableName(value: string): boolean {
  return (
    value !== "." &&
    value !== ".." &&
    !value.startsWith("~") &&
    !/^[A-Za-z]:/u.test(value) &&
    !/[\\/]/u.test(value) &&
    !/\s/u.test(value) &&
    !Array.from(value).some(isControlCharacter)
  );
}

function validateConfiguredExecutable(
  executable: string,
  source: Exclude<VitrineRuntimeSource, "path">,
): VitrineExecutableResolution {
  if (
    !Array.from(executable).some(isControlCharacter) &&
    (isAbsoluteExecutablePath(executable) || isBareExecutableName(executable))
  ) {
    return { executable, source };
  }

  const resolution = { executable, source } as const;
  throw new VitrineExecutableResolutionError({
    source,
    executable,
    detail: `Vitrine executable ${executableLabel(executable)} ${source === "environment" ? "from LINCEI_VITRINE_EXECUTABLE" : "configured in Settings"} must be either a bare command name resolved from PATH or an absolute executable path. ${resolutionAction(resolution)}`,
    cause: new Error(`Invalid ${source} Vitrine executable: ${executable}`),
  });
}

export function resolveVitrineExecutable(input: {
  readonly environmentExecutable?: string | null | undefined;
  readonly settingsExecutable?: string | null | undefined;
}): VitrineExecutableResolution {
  const environmentExecutable = input.environmentExecutable?.trim();
  if (environmentExecutable) {
    return validateConfiguredExecutable(expandHomePath(environmentExecutable), "environment");
  }

  const settingsExecutable = input.settingsExecutable?.trim();
  if (settingsExecutable) {
    return validateConfiguredExecutable(expandHomePath(settingsExecutable), "settings");
  }

  return {
    executable: DEFAULT_VITRINE_EXECUTABLE,
    source: "path",
  };
}

export function makeVitrineExecutableResolver(input: {
  readonly environmentExecutable?: string | null | undefined;
  readonly readSettingsExecutable: () => Effect.Effect<
    string | null | undefined,
    VitrineExecutableResolutionError
  >;
}): () => Effect.Effect<VitrineExecutableResolution, VitrineExecutableResolutionError> {
  const resolve = (resolutionInput: Parameters<typeof resolveVitrineExecutable>[0]) =>
    Effect.try({
      try: () => resolveVitrineExecutable(resolutionInput),
      catch: (cause) =>
        cause instanceof VitrineExecutableResolutionError
          ? cause
          : new VitrineExecutableResolutionError({ cause }),
    });
  const environmentExecutable = input.environmentExecutable?.trim();
  if (environmentExecutable) {
    return () => resolve({ environmentExecutable });
  }

  return () =>
    input
      .readSettingsExecutable()
      .pipe(Effect.flatMap((settingsExecutable) => resolve({ settingsExecutable })));
}

function executableLabel(executable: string): string {
  return `\`${sanitizePublicText(executable, 200) || DEFAULT_VITRINE_EXECUTABLE}\``;
}

function resolutionAction(resolution: VitrineExecutableResolution): string {
  switch (resolution.source) {
    case "environment":
      return "Fix or unset LINCEI_VITRINE_EXECUTABLE and restart Lincei.";
    case "settings":
      return "Choose a valid Vitrine executable path in Settings.";
    case "path":
      return `Install Vitrine ${VITRINE_SUPPORTED_VERSION_RANGE}, or configure its executable path in Settings.`;
  }
}

function resolutionFromError(error: VitrineExecutableResolutionError): VitrineExecutableResolution {
  return {
    source: error.source ?? "path",
    executable:
      sanitizePublicText(error.executable ?? DEFAULT_VITRINE_EXECUTABLE, 200) ||
      DEFAULT_VITRINE_EXECUTABLE,
  };
}

function spawnFailureReason(cause: ProcessSpawnError): string {
  const platformCause = cause.cause as
    | {
        readonly _tag?: unknown;
        readonly reason?: { readonly _tag?: unknown } | undefined;
      }
    | null
    | undefined;
  const reason = platformCause?._tag === "PlatformError" ? platformCause.reason?._tag : undefined;
  if (reason === "NotFound") {
    return "The executable or project directory was not found.";
  }
  if (reason === "PermissionDenied") {
    return "Permission was denied while launching the executable.";
  }
  return "The process could not be created.";
}

function executableUnavailableDetail(
  resolution: VitrineExecutableResolution,
  cause: ProcessSpawnError,
): string {
  const executable = executableLabel(resolution.executable);
  const source =
    resolution.source === "environment"
      ? " from LINCEI_VITRINE_EXECUTABLE"
      : resolution.source === "settings"
        ? " configured in Settings"
        : " using the backend PATH";
  return `Could not launch Vitrine executable ${executable}${source}. ${spawnFailureReason(cause)} ${resolutionAction(resolution)}`;
}

function makeRuntimeStatus(
  resolution: VitrineExecutableResolution,
  input: {
    readonly status: VitrineRuntimeStatus["status"];
    readonly version?: string | null | undefined;
    readonly lifecycleContractVersion?: number | null | undefined;
    readonly pythonExecutable?: string | null | undefined;
    readonly message?: string | null | undefined;
  },
): Effect.Effect<VitrineRuntimeStatus> {
  return DateTime.now.pipe(
    Effect.map((now) => ({
      status: input.status,
      source: resolution.source,
      executable: resolution.executable,
      version: input.version ?? null,
      lifecycleContractVersion: input.lifecycleContractVersion ?? null,
      pythonExecutable: input.pythonExecutable ?? null,
      supportedVersionRange: VITRINE_SUPPORTED_VERSION_RANGE,
      requiredLifecycleContractVersion: VITRINE_REQUIRED_LIFECYCLE_CONTRACT_VERSION,
      message: input.message ?? null,
      checkedAt: DateTime.formatIso(now),
    })),
  );
}

interface ParsedDoctorPayload {
  readonly version: string;
  readonly lifecycleContractVersion: number;
  readonly pythonExecutable: string;
}

function parseDoctorPayload(stdout: string): ParsedDoctorPayload | null {
  const trimmed = stdout.trim();
  if (trimmed.length === 0) return null;

  try {
    const payload = decodeDoctorPayload(JSON.parse(trimmed));
    const version = sanitizePublicText(payload.version, MAX_PUBLIC_VERSION_LENGTH);
    const pythonExecutable = sanitizePublicText(payload.python_executable, MAX_PUBLIC_PATH_LENGTH);
    if (version.length === 0 || pythonExecutable.length === 0) return null;
    return {
      version,
      lifecycleContractVersion: payload.lifecycle_contract_version,
      pythonExecutable,
    };
  } catch {
    return null;
  }
}

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

function commandTimeout(action: VitrineCliAction): Duration.Duration {
  return action === "start" ? START_TIMEOUT : COMMAND_TIMEOUT;
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
  const publicVersion = sanitizePublicText(version, MAX_PUBLIC_VERSION_LENGTH);
  if (!satisfiesSemverRange(publicVersion, VITRINE_SUPPORTED_VERSION_RANGE)) {
    throw cliError({
      action,
      code: "incompatible_version",
      detail: `Vitrine ${publicVersion || "version not reported"} is incompatible; expected ${VITRINE_SUPPORTED_VERSION_RANGE}.`,
    });
  }
  return publicVersion;
}

function lifecycleFailureDetail(payload: typeof FailedPayload.Type): string {
  for (const candidate of [payload.message, payload.error]) {
    if (candidate === undefined) continue;
    const sanitized = sanitizePublicText(candidate, MAX_PUBLIC_MESSAGE_LENGTH);
    if (sanitized.length > 0) return sanitized;
  }
  return "Vitrine lifecycle command failed.";
}

function validateSessionId(action: VitrineCliAction, sessionId: string): string {
  const sanitized = sanitizePublicText(sessionId, MAX_PUBLIC_SESSION_ID_LENGTH);
  if (
    sanitized.length === 0 ||
    Array.from(sessionId).length > MAX_PUBLIC_SESSION_ID_LENGTH ||
    Array.from(sessionId).some(isControlCharacter)
  ) {
    throw cliError({
      action,
      code: "invalid_status_payload",
      detail: "Vitrine returned invalid process identity metadata.",
    });
  }
  return sanitized;
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
  const failedDetail = payload.status === "failed" ? lifecycleFailureDetail(payload) : undefined;
  let version: string;
  try {
    version = validateVersion(input.action, payload.version);
  } catch (cause) {
    if (
      failedDetail !== undefined &&
      cause instanceof VitrineCliError &&
      cause.code === "incompatible_version"
    ) {
      throw cliError({
        action: input.action,
        code: cause.code,
        detail: `${cause.detail} Vitrine reported: ${failedDetail}`,
        cause,
      });
    }
    throw cause;
  }

  const dataDir = validateDataDir(input.action, input.path, input.workspaceRoot, payload.data_dir);
  if (payload.status === "failed") {
    throw cliError({
      action: input.action,
      code: input.action === "start" ? "process_exited" : "command_failed",
      detail: failedDetail ?? "Vitrine lifecycle command failed.",
    });
  }

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

  const sessionId = validateSessionId(input.action, payload.session_id);
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
    sessionId,
    dataDir,
    version,
  };
}

function lifecycleProcessError(
  action: VitrineCliAction,
  resolution: VitrineExecutableResolution,
  cause: ProcessRunError,
): VitrineCliError {
  if (cause instanceof ProcessSpawnError) {
    return cliError({
      action,
      code: "executable_unavailable",
      detail: executableUnavailableDetail(resolution, cause),
      cause,
    });
  }
  if (cause instanceof ProcessTimeoutError) {
    return cliError({
      action,
      code: "startup_timeout",
      detail: `Vitrine ${action} timed out while using ${executableLabel(resolution.executable)}.`,
      cause,
    });
  }
  return cliError({
    action,
    code: "command_failed",
    detail: `Vitrine ${action} failed while using ${executableLabel(resolution.executable)}.`,
    cause,
  });
}

function runtimeStatusFromDoctorOutput(
  resolution: VitrineExecutableResolution,
  output: ProcessRunOutput,
): Effect.Effect<VitrineRuntimeStatus> {
  const executable = executableLabel(resolution.executable);
  if (output.code !== 0) {
    return makeRuntimeStatus(resolution, {
      status: "failed",
      message: `Vitrine runtime check failed for ${executable}. ${resolutionAction(resolution)}`,
    });
  }

  const payload = parseDoctorPayload(output.stdout);
  if (payload === null) {
    return makeRuntimeStatus(resolution, {
      status: "failed",
      message: `Vitrine runtime check returned invalid JSON from ${executable}. ${resolutionAction(resolution)}`,
    });
  }

  const common = {
    version: payload.version,
    lifecycleContractVersion: payload.lifecycleContractVersion,
    pythonExecutable: payload.pythonExecutable,
  } as const;
  if (payload.lifecycleContractVersion !== VITRINE_REQUIRED_LIFECYCLE_CONTRACT_VERSION) {
    return makeRuntimeStatus(resolution, {
      status: "incompatible",
      ...common,
      message: `Vitrine runtime ${executable} uses lifecycle contract ${payload.lifecycleContractVersion}; expected ${VITRINE_REQUIRED_LIFECYCLE_CONTRACT_VERSION}. ${resolutionAction(resolution)}`,
    });
  }
  if (!satisfiesSemverRange(payload.version, VITRINE_SUPPORTED_VERSION_RANGE)) {
    return makeRuntimeStatus(resolution, {
      status: "incompatible",
      ...common,
      message: `Vitrine ${payload.version} at ${executable} is incompatible; expected ${VITRINE_SUPPORTED_VERSION_RANGE}. ${resolutionAction(resolution)}`,
    });
  }

  return makeRuntimeStatus(resolution, {
    status: "ready",
    ...common,
  });
}

function runtimeStatusFromProcessError(
  resolution: VitrineExecutableResolution,
  cause: ProcessRunError,
): Effect.Effect<VitrineRuntimeStatus> {
  if (cause instanceof ProcessSpawnError) {
    return makeRuntimeStatus(resolution, {
      status: "unavailable",
      message: executableUnavailableDetail(resolution, cause),
    });
  }
  if (cause instanceof ProcessTimeoutError) {
    return makeRuntimeStatus(resolution, {
      status: "failed",
      message: `Vitrine runtime check timed out for ${executableLabel(resolution.executable)}. ${resolutionAction(resolution)}`,
    });
  }
  return makeRuntimeStatus(resolution, {
    status: "failed",
    message: `Vitrine runtime check failed for ${executableLabel(resolution.executable)}. Check the server logs. ${resolutionAction(resolution)}`,
  });
}

export function makeVitrineCli(input: {
  readonly path: Path.Path;
  readonly processRunner: ProcessRunnerShape;
  readonly resolveExecutable?:
    | (() => Effect.Effect<VitrineExecutableResolution, VitrineExecutableResolutionError>)
    | undefined;
}): VitrineCliShape {
  const resolveExecutable =
    input.resolveExecutable ??
    (() =>
      Effect.succeed(
        resolveVitrineExecutable({
          environmentExecutable: undefined,
          settingsExecutable: undefined,
        }),
      ));
  const resolvedExecutable = Effect.suspend(resolveExecutable);

  const run: VitrineCliShape["run"] = (action, cliInput) =>
    resolvedExecutable.pipe(
      Effect.mapError((cause) =>
        cliError({
          action,
          code: cause.source === undefined ? "command_failed" : "executable_unavailable",
          detail: cause.detail ?? "Lincei could not read the Vitrine runtime configuration.",
          cause,
        }),
      ),
      Effect.flatMap((resolution) =>
        input.processRunner
          .run({
            command: resolution.executable,
            args: commandArgs(action),
            cwd: cliInput.workspaceRoot,
            env: { VITRINE_DATA_DIR: expectedDataDir(input.path, cliInput.workspaceRoot) },
            shell: false,
            timeout: commandTimeout(action),
            maxOutputBytes: MAX_OUTPUT_BYTES,
          })
          .pipe(
            Effect.mapError((cause) => lifecycleProcessError(action, resolution, cause)),
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
          ),
      ),
    );

  const probeRuntime = (resolution: VitrineExecutableResolution) =>
    input.processRunner
      .run({
        command: resolution.executable,
        args: ["doctor", "--json"],
        shell: false,
        timeout: COMMAND_TIMEOUT,
        maxOutputBytes: MAX_OUTPUT_BYTES,
      })
      .pipe(
        Effect.matchEffect({
          onFailure: (cause) =>
            Effect.logWarning("Vitrine runtime probe failed", {
              executable: resolution.executable,
              source: resolution.source,
              cause,
            }).pipe(Effect.andThen(runtimeStatusFromProcessError(resolution, cause))),
          onSuccess: (output) =>
            output.code === 0
              ? runtimeStatusFromDoctorOutput(resolution, output)
              : Effect.logWarning("Vitrine runtime probe exited unsuccessfully", {
                  executable: resolution.executable,
                  source: resolution.source,
                  exitCode: output.code,
                }).pipe(Effect.andThen(runtimeStatusFromDoctorOutput(resolution, output))),
        }),
      );

  const runtimeStatus: VitrineCliShape["runtimeStatus"] = resolvedExecutable.pipe(
    Effect.matchEffect({
      onFailure: (cause) =>
        Effect.logWarning("Failed to resolve Vitrine runtime configuration", { cause }).pipe(
          Effect.andThen(
            makeRuntimeStatus(resolutionFromError(cause), {
              status: cause.source === undefined ? "failed" : "unavailable",
              message:
                cause.detail ??
                "Lincei could not read the Vitrine runtime configuration. Check the server logs.",
            }),
          ),
        ),
      onSuccess: probeRuntime,
    }),
    Effect.withSpan("vitrine.runtimeStatus"),
  );

  return VitrineCli.of({ run, runtimeStatus });
}

export const VitrineCliLive = Layer.effect(
  VitrineCli,
  Effect.gen(function* () {
    const path = yield* Path.Path;
    const processRunner = yield* ProcessRunner;
    const serverSettings = yield* ServerSettingsService;
    const environmentExecutable = process.env.LINCEI_VITRINE_EXECUTABLE?.trim();
    return makeVitrineCli({
      path,
      processRunner,
      resolveExecutable: makeVitrineExecutableResolver({
        environmentExecutable,
        readSettingsExecutable: () =>
          serverSettings.getSettings.pipe(
            Effect.map((settings) => settings.vitrine.executablePath),
            Effect.mapError(
              (cause) =>
                new VitrineExecutableResolutionError({
                  cause,
                }),
            ),
          ),
      }),
    });
  }),
);
