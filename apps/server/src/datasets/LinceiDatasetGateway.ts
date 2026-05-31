import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import {
  DATASET_BACKEND_IDS,
  DATASET_IDS,
  DatasetRpcError,
  ServerSettingsError,
  type DatasetBackendId,
  type DatasetId,
  type DatasetStatusResult,
} from "@t3tools/contracts";

import { ServerConfig } from "../config.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import { M4Cli } from "./M4Cli.ts";
import { M4DatasetService } from "./M4DatasetService.ts";
import { makeDatasetWorkspacePathResolver } from "./workspace.ts";

export const DATASET_CONTEXT_SAFE_COMMAND_GUIDANCE =
  "Use `lincei dataset ...` for dataset operations; Lincei infers dataset/backend when unambiguous. Avoid `m4 use` and bare `m4`, `uvx m4`, or `uv run m4` calls; Lincei treats dataset selection as request-scoped.";

const DATASET_TOOLS = [
  "status",
  "capabilities",
  "schema",
  "describe-table",
  "query",
  "context",
  "m4",
] as const;

export type LinceiDatasetTool = (typeof DATASET_TOOLS)[number];

export interface DatasetAccessPolicy {
  readonly allowedDatasets?: ReadonlyArray<DatasetId> | undefined;
  readonly allowedBackends?: ReadonlyArray<DatasetBackendId> | undefined;
  readonly allowedTools?: ReadonlyArray<LinceiDatasetTool> | undefined;
  readonly allowRawPaths: boolean;
  readonly allowMutations: boolean;
}

export const DEFAULT_DATASET_ACCESS_POLICY: DatasetAccessPolicy = {
  allowedDatasets: undefined,
  allowedBackends: undefined,
  allowedTools: undefined,
  allowRawPaths: true,
  allowMutations: true,
};

export interface DatasetCommandSelection {
  readonly datasetId?: DatasetId | undefined;
  readonly backendId?: DatasetBackendId | undefined;
}

export interface DatasetGatewayResolvedContext {
  readonly workspacePath: string;
  readonly defaultBackendId: DatasetBackendId;
  readonly m4Command: string;
}

export interface DatasetGatewayJsonResult {
  readonly command: string;
  readonly workspacePath: string;
  readonly datasetId?: DatasetId | undefined;
  readonly backendId?: DatasetBackendId | undefined;
  readonly json: unknown;
}

export interface DatasetGatewayRawResult {
  readonly command: string;
  readonly workspacePath: string;
  readonly stdout: string;
  readonly stderr: string;
}

export interface DatasetGatewayContextResult {
  readonly guidance: string;
  readonly workspacePath: string;
  readonly selectedDatasetId?: DatasetId | undefined;
  readonly defaultBackendId: DatasetBackendId;
  readonly commands: ReadonlyArray<string>;
  readonly status: DatasetStatusResult;
}

export interface LinceiDatasetGatewayShape {
  readonly resolveContext: () => Effect.Effect<DatasetGatewayResolvedContext, DatasetRpcError>;
  readonly status: (
    input?: DatasetCommandSelection,
  ) => Effect.Effect<DatasetStatusResult, DatasetRpcError>;
  readonly capabilities: (
    input?: DatasetCommandSelection,
  ) => Effect.Effect<DatasetGatewayJsonResult, DatasetRpcError>;
  readonly schema: (
    input?: DatasetCommandSelection,
  ) => Effect.Effect<DatasetGatewayJsonResult, DatasetRpcError>;
  readonly describeTable: (
    input: DatasetCommandSelection & { readonly table: string },
  ) => Effect.Effect<DatasetGatewayJsonResult, DatasetRpcError>;
  readonly query: (
    input: DatasetCommandSelection & { readonly sql: string },
  ) => Effect.Effect<DatasetGatewayJsonResult, DatasetRpcError>;
  readonly context: (
    input?: DatasetCommandSelection,
  ) => Effect.Effect<DatasetGatewayContextResult, DatasetRpcError>;
  readonly runM4: (
    args: ReadonlyArray<string>,
  ) => Effect.Effect<DatasetGatewayRawResult, DatasetRpcError>;
}

export class LinceiDatasetGateway extends Context.Service<
  LinceiDatasetGateway,
  LinceiDatasetGatewayShape
>()("t3/datasets/LinceiDatasetGateway") {}

function settingsError(error: ServerSettingsError): DatasetRpcError {
  return new DatasetRpcError({
    code: "settings_error",
    detail: error.message,
    actionableMessage: "Lincei could not read dataset settings.",
  });
}

function policyDenied(detail: string): DatasetRpcError {
  return new DatasetRpcError({
    code: "policy_denied",
    detail,
    actionableMessage: detail,
  });
}

function missingDatasetSelection(tool: LinceiDatasetTool): DatasetRpcError {
  return new DatasetRpcError({
    code: "policy_denied",
    detail: `Dataset tool '${tool}' could not infer a single dataset.`,
    actionableMessage: `Run this command with --dataset <${DATASET_IDS.join("|")}>.`,
  });
}

function ambiguousDatasetSelection(
  tool: LinceiDatasetTool,
  candidates: ReadonlyArray<DatasetId>,
): DatasetRpcError {
  return new DatasetRpcError({
    code: "policy_denied",
    detail: `Dataset tool '${tool}' could not infer a single dataset. Candidates: ${candidates.join(", ")}.`,
    actionableMessage: `Run this command with --dataset <${candidates.join("|")}>.`,
  });
}

const datasetIds = new Set<string>(DATASET_IDS);
const backendIds = new Set<string>(DATASET_BACKEND_IDS);
const mutatingM4Commands = new Set([
  "backend",
  "download",
  "init",
  "init-derived",
  "materialize",
  "use",
]);

function isDatasetId(value: string | undefined): value is DatasetId {
  return value !== undefined && datasetIds.has(value);
}

function isBackendId(value: string | undefined): value is DatasetBackendId {
  return value !== undefined && backendIds.has(value);
}

function looksLikeRawPath(value: string): boolean {
  return (
    value.startsWith("/") ||
    value.startsWith("~/") ||
    value.startsWith("~\\") ||
    /^[a-zA-Z]:[\\/]/.test(value) ||
    value.includes("../") ||
    value.includes("..\\")
  );
}

function isReadOnlySql(sql: string): boolean {
  const normalized = sql
    .trim()
    .replace(/^--.*(?:\r?\n|$)/gm, "")
    .trim()
    .toLowerCase();
  if (normalized.length === 0 || /;\s*\S/.test(normalized)) {
    return false;
  }
  const firstKeyword = /^[a-z]+/.exec(normalized)?.[0];
  return (
    firstKeyword === "select" ||
    firstKeyword === "with" ||
    firstKeyword === "explain" ||
    firstKeyword === "describe" ||
    firstKeyword === "show"
  );
}

function selectionArgs(selection: DatasetCommandSelection): ReadonlyArray<string> {
  return [
    ...(selection.datasetId ? ["--dataset", selection.datasetId] : []),
    ...(selection.backendId ? ["--backend", selection.backendId] : []),
  ];
}

const inferDatasetSelection = Effect.fn("inferDatasetSelection")(function* (
  tool: LinceiDatasetTool,
  status: DatasetStatusResult,
  backendId: DatasetBackendId | undefined,
) {
  const preferred = status.appReadiness.activeDatasetId ?? status.appReadiness.selectedDatasetId;
  if (preferred !== undefined) {
    return {
      datasetId: preferred,
      backendId:
        backendId ?? status.appReadiness.activeBackendId ?? status.appReadiness.selectedBackendId,
    };
  }

  const candidates = status.datasets
    .filter((dataset) => backendId === undefined || dataset.backendId === backendId)
    .filter(
      (dataset) => dataset.active === true || dataset.selected === true || dataset.initialized,
    )
    .map((dataset) => dataset.datasetId);
  const uniqueCandidates = [...new Set(candidates)];
  if (uniqueCandidates.length === 1) {
    return { datasetId: uniqueCandidates[0]!, ...(backendId ? { backendId } : {}) };
  }
  if (uniqueCandidates.length > 1) {
    return yield* ambiguousDatasetSelection(tool, uniqueCandidates);
  }
  return yield* missingDatasetSelection(tool);
});

export function formatDatasetContextMarkdown(context: DatasetGatewayContextResult): string {
  return [
    "# Lincei Dataset Context",
    "",
    DATASET_CONTEXT_SAFE_COMMAND_GUIDANCE,
    "",
    `Workspace: ${context.workspacePath}`,
    `Default backend: ${context.defaultBackendId}`,
    ...(context.selectedDatasetId
      ? [
          `Selected dataset: ${context.selectedDatasetId}`,
          `Selected dataset ready: ${context.status.appReadiness.clinicalDataReady ? "yes" : "no"}`,
          `Readiness: ${context.status.appReadiness.readiness}`,
        ]
      : ["Selected dataset: not provided", "Clinical data readiness is per dataset request."]),
    "",
    "Preferred commands:",
    ...context.commands.map((command) => `- ${command}`),
  ].join("\n");
}

export const makeLinceiDatasetGateway = (
  policy: DatasetAccessPolicy = DEFAULT_DATASET_ACCESS_POLICY,
) =>
  Effect.gen(function* () {
    const serverSettings = yield* ServerSettingsService;
    const datasetService = yield* M4DatasetService;
    const m4Cli = yield* M4Cli;
    const config = yield* ServerConfig;
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const resolveDatasetWorkspacePath = makeDatasetWorkspacePathResolver({
      config,
      fileSystem,
      path,
    });

    const enforceTool = (tool: LinceiDatasetTool) => {
      if (policy.allowedTools !== undefined && !policy.allowedTools.includes(tool)) {
        return Effect.fail(policyDenied(`Dataset tool '${tool}' is not allowed by policy.`));
      }
      return Effect.void;
    };

    const enforceSelection = (selection: DatasetCommandSelection) => {
      if (
        selection.datasetId !== undefined &&
        policy.allowedDatasets !== undefined &&
        !policy.allowedDatasets.includes(selection.datasetId)
      ) {
        return Effect.fail(
          policyDenied(`Dataset '${selection.datasetId}' is not allowed by policy.`),
        );
      }
      if (
        selection.backendId !== undefined &&
        policy.allowedBackends !== undefined &&
        !policy.allowedBackends.includes(selection.backendId)
      ) {
        return Effect.fail(
          policyDenied(`Dataset backend '${selection.backendId}' is not allowed by policy.`),
        );
      }
      return Effect.void;
    };

    const resolveContext: LinceiDatasetGatewayShape["resolveContext"] = () =>
      Effect.gen(function* () {
        const settings = yield* serverSettings.getSettings.pipe(Effect.mapError(settingsError));
        const workspacePath = yield* resolveDatasetWorkspacePath(settings.datasets.workspacePath);
        return {
          workspacePath,
          defaultBackendId: settings.datasets.preferredBackendId,
          m4Command: settings.datasets.m4Command || m4Cli.defaultCommand,
        };
      });

    const resolveSelection = (input: DatasetCommandSelection | undefined) =>
      Effect.gen(function* () {
        const context = yield* resolveContext();
        const selection = {
          datasetId: input?.datasetId,
          backendId: input?.backendId ?? context.defaultBackendId,
        } satisfies DatasetCommandSelection;
        yield* enforceSelection(selection);
        return { context, selection };
      });

    const runJsonTool = (input: {
      readonly tool: Exclude<LinceiDatasetTool, "status" | "context" | "m4">;
      readonly selection?: DatasetCommandSelection | undefined;
      readonly args: ReadonlyArray<string>;
      readonly requireDataset?: boolean | undefined;
    }) =>
      Effect.gen(function* () {
        yield* enforceTool(input.tool);
        const { context, selection } = yield* resolveSelection(input.selection);
        const effectiveSelection = yield* Effect.gen(function* () {
          if (input.requireDataset !== true || selection.datasetId !== undefined) {
            return selection;
          }
          const statusExit = yield* Effect.exit(datasetService.getStatus(selection));
          if (statusExit._tag === "Failure") {
            return yield* missingDatasetSelection(input.tool);
          }
          return yield* inferDatasetSelection(input.tool, statusExit.value, selection.backendId);
        });
        const result = yield* m4Cli.json({
          cwd: context.workspacePath,
          args: [...input.args, ...selectionArgs(effectiveSelection), "--json", "--no-interactive"],
        });
        return {
          command: result.command,
          workspacePath: context.workspacePath,
          ...(effectiveSelection.datasetId ? { datasetId: effectiveSelection.datasetId } : {}),
          ...(effectiveSelection.backendId ? { backendId: effectiveSelection.backendId } : {}),
          json: result.json,
        };
      });

    const status: LinceiDatasetGatewayShape["status"] = (input) =>
      Effect.gen(function* () {
        yield* enforceTool("status");
        if (input?.datasetId !== undefined) {
          const { selection } = yield* resolveSelection(input);
          return yield* datasetService.getStatus(selection);
        }
        if (input !== undefined) {
          yield* enforceSelection(input);
        }
        return yield* datasetService.getStatus(input);
      });

    const capabilities: LinceiDatasetGatewayShape["capabilities"] = (input) =>
      runJsonTool({ tool: "capabilities", selection: input, args: ["capabilities"] });

    const schema: LinceiDatasetGatewayShape["schema"] = (input) =>
      runJsonTool({ tool: "schema", selection: input, args: ["schema"], requireDataset: true });

    const describeTable: LinceiDatasetGatewayShape["describeTable"] = (input) =>
      runJsonTool({
        tool: "describe-table",
        selection: input,
        args: ["describe-table", input.table],
        requireDataset: true,
      });

    const query: LinceiDatasetGatewayShape["query"] = (input) =>
      Effect.gen(function* () {
        if (!isReadOnlySql(input.sql)) {
          return yield* policyDenied("Only read-only dataset SQL queries are allowed in V1.");
        }
        return yield* runJsonTool({
          tool: "query",
          selection: input,
          args: ["query", "--sql", input.sql],
          requireDataset: true,
        });
      });

    const context: LinceiDatasetGatewayShape["context"] = (input) =>
      Effect.gen(function* () {
        yield* enforceTool("context");
        const [resolved, statusResult] = yield* Effect.all([
          resolveSelection(input),
          status(input),
        ]);
        const inferredSelection =
          resolved.selection.datasetId === undefined
            ? yield* inferDatasetSelection(
                "context",
                statusResult,
                resolved.selection.backendId,
              ).pipe(Effect.catch(() => Effect.succeed(resolved.selection)))
            : resolved.selection;
        return {
          guidance: DATASET_CONTEXT_SAFE_COMMAND_GUIDANCE,
          workspacePath: resolved.context.workspacePath,
          ...(inferredSelection.datasetId
            ? { selectedDatasetId: inferredSelection.datasetId }
            : {}),
          defaultBackendId: inferredSelection.backendId ?? resolved.context.defaultBackendId,
          commands: [
            "lincei dataset status",
            "lincei dataset status --dataset mimic-iv-demo --backend duckdb",
            "lincei dataset capabilities --backend duckdb",
            "lincei dataset schema --dataset mimic-iv-demo --backend duckdb",
            "lincei dataset describe-table admissions --dataset mimic-iv-demo --backend duckdb",
            'lincei dataset query --dataset mimic-iv-demo --backend duckdb --sql "select ... limit 10"',
            "lincei dataset context --dataset mimic-iv-demo --backend duckdb --format markdown",
          ],
          status: statusResult,
        };
      });

    const runM4: LinceiDatasetGatewayShape["runM4"] = (args) =>
      Effect.gen(function* () {
        yield* enforceTool("m4");
        if (!policy.allowMutations && mutatingM4Commands.has(args[0] ?? "")) {
          return yield* policyDenied(`M4 command '${args[0]}' is not allowed by policy.`);
        }
        if (!policy.allowRawPaths) {
          const rawPath = args.find(looksLikeRawPath);
          if (rawPath !== undefined) {
            return yield* policyDenied(`Raw path argument '${rawPath}' is not allowed by policy.`);
          }
        }
        for (let index = 0; index < args.length; index += 1) {
          const arg = args[index]!;
          const value = args[index + 1];
          if ((arg === "--dataset" || arg === "--dataset-id") && isDatasetId(value)) {
            yield* enforceSelection({ datasetId: value });
          }
          if ((arg === "--backend" || arg === "--backend-id") && isBackendId(value)) {
            yield* enforceSelection({ backendId: value });
          }
        }
        const context = yield* resolveContext();
        const result = yield* m4Cli.exec({
          cwd: context.workspacePath,
          args,
          outputMode: "truncate",
        });
        return {
          command: result.command,
          workspacePath: context.workspacePath,
          stdout: result.output.stdout,
          stderr: result.output.stderr,
        };
      });

    return LinceiDatasetGateway.of({
      resolveContext,
      status,
      capabilities,
      schema,
      describeTable,
      query,
      context,
      runM4,
    });
  });

export const layer = Layer.effect(LinceiDatasetGateway, makeLinceiDatasetGateway());

export const layerWithPolicy = (policy: DatasetAccessPolicy) =>
  Layer.effect(LinceiDatasetGateway, makeLinceiDatasetGateway(policy));
