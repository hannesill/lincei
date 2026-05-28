import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import {
  DATASET_IDS,
  DatasetRpcError,
  ServerSettingsError,
  type DatasetBackendId,
  type DatasetCredentialPresence,
  type DatasetId,
  type DatasetReadinessState,
  type DatasetStatusResult,
  type DatasetStatusSnapshot,
} from "@t3tools/contracts";
import { decodeJsonResult, formatSchemaError } from "@t3tools/shared/schemaJson";

import {
  isWindowsCommandNotFound,
  ProcessOutputLimitError,
  ProcessRunner,
  ProcessSpawnError,
  ProcessTimeoutError,
  type ProcessRunError,
  type ProcessRunOutput,
} from "../processRunner.ts";
import { ServerSettingsService } from "../serverSettings.ts";

const DEFAULT_M4_COMMAND = "uvx --from m4-infra m4";
const M4_MINIMUM_VERSION = "0.4.4";
const MAX_OUTPUT_BYTES = 256 * 1024;
const STATUS_TIMEOUT = Duration.seconds(30);
const COMMAND_TIMEOUT = Duration.minutes(15);

const M4_UPDATE_MESSAGE = `Install or update m4-infra >=${M4_MINIMUM_VERSION}.`;

const datasetIds = new Set<string>(DATASET_IDS);

const M4BackendId = Schema.Literals(["duckdb", "bigquery"]);
const M4NullableString = Schema.NullOr(Schema.String);
const M4NullableNumber = Schema.NullOr(Schema.Number);

const M4CommandErrorPayload = Schema.Struct({
  code: Schema.String,
  message: Schema.String,
  hint: Schema.optional(Schema.String),
});

const M4CommandEnvelope = Schema.Struct({
  version: Schema.Number,
  ok: Schema.Boolean,
  command: Schema.String,
  warnings: Schema.optional(Schema.Array(Schema.String)),
  error: Schema.optional(M4CommandErrorPayload),
});

export type M4CommandEnvelope = typeof M4CommandEnvelope.Type;

const M4StatusDataset = Schema.Struct({
  name: Schema.String,
  active: Schema.Boolean,
  parquet_present: Schema.Boolean,
  db_present: Schema.Boolean,
  parquet_root: M4NullableString,
  db_path: M4NullableString,
  bigquery_available: Schema.Boolean,
  row_count: M4NullableNumber,
  parquet_size_gb: M4NullableNumber,
  derived: Schema.Struct({
    supported: Schema.Boolean,
    total: M4NullableNumber,
    materialized: M4NullableNumber,
    bigquery: Schema.Boolean,
  }),
  warnings: Schema.Array(Schema.String),
});

const M4StatusSnapshot = Schema.Struct({
  version: Schema.Number,
  active_dataset: M4NullableString,
  backend: M4BackendId,
  bigquery_project_id: M4NullableString,
  datasets: Schema.Array(M4StatusDataset),
});

type M4StatusSnapshot = typeof M4StatusSnapshot.Type;
type M4StatusDataset = typeof M4StatusDataset.Type;

const decodeM4CommandEnvelope = decodeJsonResult(M4CommandEnvelope);
const decodeM4StatusSnapshot = decodeJsonResult(M4StatusSnapshot);

export interface M4CliStatusInput {
  readonly cwd: string;
  readonly credentials: DatasetCredentialPresence;
}

export interface M4CliCommandInput {
  readonly cwd: string;
}

export interface M4CliInitializeInput extends M4CliCommandInput {
  readonly datasetId: DatasetId;
}

export interface M4CliSetActiveDatasetInput extends M4CliCommandInput {
  readonly datasetId: DatasetId;
}

export interface M4CliSetBackendInput extends M4CliCommandInput {
  readonly backendId: DatasetBackendId;
  readonly projectId?: string | undefined;
}

export interface M4CliShape {
  readonly defaultCommand: string;
  readonly resolveCommand: (configuredCommand: string) => {
    readonly command: string;
    readonly prefixArgs: ReadonlyArray<string>;
  };
  readonly status: (input: M4CliStatusInput) => Effect.Effect<DatasetStatusResult, DatasetRpcError>;
  readonly initialize: (
    input: M4CliInitializeInput,
  ) => Effect.Effect<M4CommandEnvelope, DatasetRpcError>;
  readonly use: (
    input: M4CliSetActiveDatasetInput,
  ) => Effect.Effect<M4CommandEnvelope, DatasetRpcError>;
  readonly backend: (
    input: M4CliSetBackendInput,
  ) => Effect.Effect<M4CommandEnvelope, DatasetRpcError>;
}

export class M4Cli extends Context.Service<M4Cli, M4CliShape>()("t3/datasets/M4Cli") {}

function splitCommand(command: string): ReadonlyArray<string> {
  const words: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  let escaping = false;

  for (const char of command.trim()) {
    if (escaping) {
      current += char;
      escaping = false;
      continue;
    }
    if (char === "\\") {
      escaping = true;
      continue;
    }
    if (quote !== null) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current.length > 0) {
        words.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }
  if (current.length > 0) {
    words.push(current);
  }
  return words;
}

function safeOutput(output: string): string {
  return Array.from(output)
    .filter((char) => {
      const code = char.charCodeAt(0);
      return code >= 32 || char === "\n" || char === "\r" || char === "\t";
    })
    .join("")
    .replace(/[^\S\r\n]+/g, " ")
    .trim()
    .slice(0, 4096);
}

function formatCommand(command: string, args: ReadonlyArray<string>): string {
  return [command, ...args].join(" ");
}

function m4Unavailable(input: {
  readonly detail: string;
  readonly command: string;
  readonly exitCode?: number | undefined;
  readonly stderr?: string | undefined;
}): DatasetRpcError {
  return new DatasetRpcError({
    code: "m4_unavailable",
    detail: input.detail,
    actionableMessage: `${input.detail} ${M4_UPDATE_MESSAGE}`,
    command: input.command,
    ...(input.exitCode !== undefined ? { exitCode: input.exitCode } : {}),
    ...(input.stderr !== undefined && input.stderr.length > 0 ? { stderr: input.stderr } : {}),
  });
}

function commandFailed(input: {
  readonly detail: string;
  readonly command: string;
  readonly exitCode?: number | undefined;
  readonly stderr?: string | undefined;
  readonly actionableMessage?: string | undefined;
}): DatasetRpcError {
  return new DatasetRpcError({
    code: "m4_command_failed",
    detail: input.detail,
    actionableMessage: input.actionableMessage,
    command: input.command,
    ...(input.exitCode !== undefined ? { exitCode: input.exitCode } : {}),
    ...(input.stderr !== undefined && input.stderr.length > 0 ? { stderr: input.stderr } : {}),
  });
}

function invalidStatus(input: {
  readonly detail: string;
  readonly command: string;
  readonly stderr?: string | undefined;
}): DatasetRpcError {
  return new DatasetRpcError({
    code: "invalid_m4_status",
    detail: input.detail,
    actionableMessage: "M4 returned JSON that Lincei could not decode.",
    command: input.command,
    ...(input.stderr !== undefined && input.stderr.length > 0 ? { stderr: input.stderr } : {}),
  });
}

function settingsError(error: ServerSettingsError): DatasetRpcError {
  return new DatasetRpcError({
    code: "settings_error",
    detail: error.message,
    actionableMessage: "Lincei could not read dataset settings.",
  });
}

function processRunErrorToDatasetError(
  error: ProcessRunError,
  displayCommand: string,
): DatasetRpcError {
  if (error instanceof ProcessSpawnError) {
    return m4Unavailable({
      detail: `M4 command could not be started: ${displayCommand}.`,
      command: displayCommand,
    });
  }
  if (error instanceof ProcessTimeoutError) {
    return commandFailed({
      detail: `M4 command timed out after ${error.timeoutMs}ms.`,
      command: displayCommand,
    });
  }
  if (error instanceof ProcessOutputLimitError) {
    return commandFailed({
      detail: `M4 ${error.stream} exceeded the ${error.maxBytes} byte output limit.`,
      command: displayCommand,
    });
  }
  return commandFailed({
    detail: `M4 command failed: ${error._tag}.`,
    command: displayCommand,
  });
}

function looksLikeMissingJsonSupport(output: string): boolean {
  const lower = output.toLowerCase();
  return (
    lower.includes("no such option") ||
    lower.includes("unrecognized option") ||
    lower.includes("unknown option") ||
    lower.includes("got unexpected extra argument") ||
    lower.includes("no such command")
  );
}

function looksLikeJson(output: string): boolean {
  const trimmed = output.trimStart();
  return trimmed.startsWith("{") || trimmed.startsWith("[");
}

function commandErrorFromEnvelope(
  envelope: M4CommandEnvelope,
  displayCommand: string,
  exitCode: number | undefined,
  stderr: string,
): DatasetRpcError {
  const error = envelope.error;
  if (error) {
    return commandFailed({
      detail: error.message,
      actionableMessage: error.hint ?? error.message,
      command: displayCommand,
      exitCode,
      stderr,
    });
  }
  return commandFailed({
    detail: `M4 command ${envelope.command} failed.`,
    command: displayCommand,
    exitCode,
    stderr,
  });
}

function readinessForDataset(
  dataset: M4StatusDataset,
  backendId: DatasetBackendId,
  credentials: DatasetCredentialPresence,
): DatasetReadinessState {
  if (backendId === "bigquery") {
    if (!credentials.bigQuery.stored) {
      return "missing_credentials";
    }
    return dataset.bigquery_available ? "ready" : "not_initialized";
  }

  if (dataset.db_present) {
    return "ready";
  }

  const requiresPhysioNet = dataset.name !== "mimic-iv-demo";
  if (requiresPhysioNet && !credentials.physioNet.stored && !dataset.parquet_present) {
    return "missing_credentials";
  }

  return "not_initialized";
}

function mapM4Dataset(
  dataset: M4StatusDataset,
  backendId: DatasetBackendId,
  checkedAt: string,
  credentials: DatasetCredentialPresence,
): DatasetStatusSnapshot | null {
  if (!datasetIds.has(dataset.name)) {
    return null;
  }
  const datasetId = dataset.name as DatasetId;
  const readiness = readinessForDataset(dataset, backendId, credentials);
  const rowCount = dataset.row_count;

  return {
    datasetId,
    backendId,
    readiness,
    initialized: backendId === "bigquery" ? dataset.bigquery_available : dataset.db_present,
    active: dataset.active,
    ...(dataset.db_path || dataset.parquet_root
      ? { path: dataset.db_path ?? dataset.parquet_root ?? undefined }
      : {}),
    tables:
      typeof rowCount === "number"
        ? [
            {
              name: "primary",
              ready: rowCount >= 0,
              ...(rowCount >= 0 ? { rowCount } : {}),
            },
          ]
        : [],
    lastCheckedAt: checkedAt,
  };
}

function mapStatusSnapshot(input: {
  readonly snapshot: M4StatusSnapshot;
  readonly credentials: DatasetCredentialPresence;
  readonly command: string;
  readonly workspacePath: string;
  readonly checkedAt: string;
}): DatasetStatusResult {
  const checkedAt = input.checkedAt;
  const backendId = input.snapshot.backend;
  const datasets = input.snapshot.datasets.flatMap((dataset) => {
    const mapped = mapM4Dataset(dataset, backendId, checkedAt, input.credentials);
    return mapped ? [mapped] : [];
  });
  const activeDataset = datasets.find((dataset) => dataset.active);
  const activeDatasetId =
    activeDataset?.datasetId ??
    (input.snapshot.active_dataset && datasetIds.has(input.snapshot.active_dataset)
      ? (input.snapshot.active_dataset as DatasetId)
      : undefined);
  const readiness = activeDataset?.readiness ?? "not_initialized";

  return {
    runtime: {
      available: true,
      command: input.command,
      version: String(input.snapshot.version),
      workspacePath: input.workspacePath,
      checkedAt,
    },
    credentials: input.credentials,
    datasets,
    appReadiness: {
      ...(activeDatasetId ? { activeDatasetId } : {}),
      activeBackendId: backendId,
      clinicalDataReady: readiness === "ready",
      readiness,
      lastCheckedAt: checkedAt,
    },
  };
}

export const makeM4Cli = Effect.gen(function* () {
  const processRunner = yield* ProcessRunner;
  const serverSettings = yield* ServerSettingsService;

  const resolveCommand: M4CliShape["resolveCommand"] = (configuredCommand) => {
    const words = splitCommand(configuredCommand.trim() || DEFAULT_M4_COMMAND);
    const [command, ...prefixArgs] = words.length > 0 ? words : splitCommand(DEFAULT_M4_COMMAND);
    return {
      command: command ?? "uvx",
      prefixArgs,
    };
  };

  const run = (input: {
    readonly cwd: string;
    readonly lifecycleArgs: ReadonlyArray<string>;
    readonly timeout: Duration.Input;
  }) =>
    Effect.gen(function* () {
      const settings = yield* serverSettings.getSettings.pipe(Effect.mapError(settingsError));
      const resolved = resolveCommand(settings.datasets.m4Command);
      const args = [...resolved.prefixArgs, ...input.lifecycleArgs];
      const displayCommand = formatCommand(resolved.command, args);
      const output = yield* processRunner
        .run({
          command: resolved.command,
          args,
          cwd: input.cwd,
          timeout: input.timeout,
          maxOutputBytes: MAX_OUTPUT_BYTES,
          outputMode: "truncate",
          truncatedMarker: "\n[truncated]\n",
        })
        .pipe(Effect.mapError((error) => processRunErrorToDatasetError(error, displayCommand)));
      return { output, displayCommand };
    });

  function assertProcessAvailable(
    output: ProcessRunOutput,
    displayCommand: string,
  ): Effect.Effect<void, DatasetRpcError> {
    const stderr = safeOutput(output.stderr);
    if (isWindowsCommandNotFound(output.code, stderr)) {
      return Effect.fail(
        m4Unavailable({
          detail: `M4 command is not available: ${displayCommand}.`,
          command: displayCommand,
          exitCode: typeof output.code === "number" ? output.code : undefined,
          stderr,
        }),
      );
    }
    if (looksLikeMissingJsonSupport(stderr)) {
      return Effect.fail(
        m4Unavailable({
          detail: "The configured M4 command does not appear to support JSON output.",
          command: displayCommand,
          exitCode: typeof output.code === "number" ? output.code : undefined,
          stderr,
        }),
      );
    }
    return Effect.void;
  }

  const decodeEnvelope = (
    output: ProcessRunOutput,
    displayCommand: string,
  ): Effect.Effect<M4CommandEnvelope, DatasetRpcError> =>
    Effect.gen(function* () {
      yield* assertProcessAvailable(output, displayCommand);
      const stderr = safeOutput(output.stderr);
      const stdout = output.stdout.trim();
      if (!looksLikeJson(stdout)) {
        return yield* m4Unavailable({
          detail: "M4 returned human-readable output instead of JSON.",
          command: displayCommand,
          exitCode: typeof output.code === "number" ? output.code : undefined,
          stderr,
        });
      }
      const decoded = decodeM4CommandEnvelope(stdout);
      if (Result.isFailure(decoded)) {
        return yield* invalidStatus({
          detail: formatSchemaError(decoded.failure),
          command: displayCommand,
          stderr,
        });
      }
      if (decoded.success.ok === false || output.code !== 0) {
        return yield* commandErrorFromEnvelope(
          decoded.success,
          displayCommand,
          typeof output.code === "number" ? output.code : undefined,
          stderr,
        );
      }
      return decoded.success;
    });

  const status: M4CliShape["status"] = (input) =>
    Effect.gen(function* () {
      const { output, displayCommand } = yield* run({
        cwd: input.cwd,
        lifecycleArgs: ["status", "--all", "--json"],
        timeout: STATUS_TIMEOUT,
      });
      yield* assertProcessAvailable(output, displayCommand);
      const stderr = safeOutput(output.stderr);
      const stdout = output.stdout.trim();

      if (!looksLikeJson(stdout)) {
        return yield* m4Unavailable({
          detail: "M4 status returned human-readable output instead of JSON.",
          command: displayCommand,
          exitCode: typeof output.code === "number" ? output.code : undefined,
          stderr,
        });
      }

      const envelope = decodeM4CommandEnvelope(stdout);
      if (Result.isSuccess(envelope) && envelope.success.ok === false) {
        return yield* commandErrorFromEnvelope(
          envelope.success,
          displayCommand,
          typeof output.code === "number" ? output.code : undefined,
          stderr,
        );
      }

      if (output.code !== 0) {
        return yield* commandFailed({
          detail: "M4 status failed without a JSON error envelope.",
          command: displayCommand,
          exitCode: typeof output.code === "number" ? output.code : undefined,
          stderr,
        });
      }

      const decoded = decodeM4StatusSnapshot(stdout);
      if (Result.isFailure(decoded)) {
        return yield* invalidStatus({
          detail: formatSchemaError(decoded.failure),
          command: displayCommand,
          stderr,
        });
      }
      const settings = yield* serverSettings.getSettings.pipe(Effect.mapError(settingsError));
      const checkedAt = yield* Effect.map(DateTime.now, DateTime.formatIso);

      return mapStatusSnapshot({
        snapshot: decoded.success,
        credentials: input.credentials,
        command: settings.datasets.m4Command || DEFAULT_M4_COMMAND,
        workspacePath: input.cwd,
        checkedAt,
      });
    });

  const initialize: M4CliShape["initialize"] = (input) =>
    Effect.gen(function* () {
      const { output, displayCommand } = yield* run({
        cwd: input.cwd,
        lifecycleArgs: ["init", input.datasetId, "--json"],
        timeout: COMMAND_TIMEOUT,
      });
      return yield* decodeEnvelope(output, displayCommand);
    });

  const use: M4CliShape["use"] = (input) =>
    Effect.gen(function* () {
      const { output, displayCommand } = yield* run({
        cwd: input.cwd,
        lifecycleArgs: ["use", input.datasetId, "--json"],
        timeout: STATUS_TIMEOUT,
      });
      return yield* decodeEnvelope(output, displayCommand);
    });

  const backend: M4CliShape["backend"] = (input) =>
    Effect.gen(function* () {
      const { output, displayCommand } = yield* run({
        cwd: input.cwd,
        lifecycleArgs: [
          "backend",
          input.backendId,
          ...(input.projectId ? ["--project-id", input.projectId] : []),
          "--json",
        ],
        timeout: STATUS_TIMEOUT,
      });
      return yield* decodeEnvelope(output, displayCommand);
    });

  return M4Cli.of({
    defaultCommand: DEFAULT_M4_COMMAND,
    resolveCommand,
    status,
    initialize,
    use,
    backend,
  });
});

export const layer = Layer.effect(M4Cli, makeM4Cli);
