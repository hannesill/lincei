import * as Console from "effect/Console";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as References from "effect/References";
import * as Schema from "effect/Schema";
import { Argument, Command, Flag, GlobalFlag } from "effect/unstable/cli";
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
} from "effect/unstable/http";

import {
  DATASET_BACKEND_IDS,
  DatasetErrorDetail,
  DATASET_IDS,
  DatasetRpcError,
  type DatasetBackendId,
  type DatasetId,
} from "@t3tools/contracts";

import { AuthControlPlaneRuntimeLive } from "../auth/Layers/AuthControlPlane.ts";
import { AuthControlPlane, type AuthControlPlaneShape } from "../auth/Services/AuthControlPlane.ts";
import { ServerSecretStoreLive } from "../auth/Layers/ServerSecretStore.ts";
import { ServerConfig } from "../config.ts";
import * as LinceiDatasetGatewayLayer from "../datasets/LinceiDatasetGateway.ts";
import {
  formatDatasetContextMarkdown,
  LinceiDatasetGateway,
  type DatasetCommandSelection,
  type DatasetGatewayJsonResult,
  type LinceiDatasetGatewayShape,
} from "../datasets/LinceiDatasetGateway.ts";
import * as M4CliLayer from "../datasets/M4Cli.ts";
import * as M4DatasetServiceLayer from "../datasets/M4DatasetService.ts";
import { layer as ProcessRunnerLive } from "../processRunner.ts";
import { readPersistedServerRuntimeState } from "../serverRuntimeState.ts";
import { ServerSettingsLive } from "../serverSettings.ts";
import { authLocationFlags, type CliAuthLocationFlags, resolveCliAuthConfig } from "./config.ts";

const DatasetBaseLive = Layer.mergeAll(
  ProcessRunnerLive,
  ServerSettingsLive,
  ServerSecretStoreLive,
);
const M4CliLive = M4CliLayer.layer.pipe(Layer.provideMerge(DatasetBaseLive));
const M4DatasetServiceLive = M4DatasetServiceLayer.layer.pipe(
  Layer.provideMerge(M4CliLive),
  Layer.provideMerge(DatasetBaseLive),
);
const DatasetCliLive = LinceiDatasetGatewayLayer.layer.pipe(
  Layer.provideMerge(M4DatasetServiceLive),
  Layer.provideMerge(M4CliLive),
  Layer.provideMerge(DatasetBaseLive),
);

const datasetFlag = Flag.choice("dataset", DATASET_IDS).pipe(
  Flag.withDescription("Dataset id for this command."),
  Flag.optional,
);

const requiredDatasetFlag = Flag.choice("dataset", DATASET_IDS).pipe(
  Flag.withDescription("Dataset id for this request. Defaults when Lincei can infer one."),
  Flag.optional,
);

const backendFlag = Flag.choice("backend", DATASET_BACKEND_IDS).pipe(
  Flag.withDescription("Dataset backend for this command."),
  Flag.optional,
);

const structuredFlag = Flag.boolean("structured").pipe(
  Flag.withDescription("Emit structured JSON for dataset context instead of prompt text."),
  Flag.withDefault(false),
);

const sqlFlag = Flag.string("sql").pipe(Flag.withDescription("SQL query to execute."));

const tableArgument = Argument.string("table").pipe(
  Argument.withDescription("Table name to describe."),
);

const m4ArgsArgument = Argument.string("m4-args").pipe(
  Argument.withDescription("Advanced M4 arguments after `--`."),
  Argument.variadic({ min: 1 }),
);

interface DatasetSelectionFlags {
  readonly datasetId: Option.Option<DatasetId>;
  readonly backendId: Option.Option<DatasetBackendId>;
}

interface RequiredDatasetSelectionFlags {
  readonly datasetId: Option.Option<DatasetId>;
  readonly backendId: Option.Option<DatasetBackendId>;
}

const selectionFromFlags = (flags: DatasetSelectionFlags): DatasetCommandSelection => ({
  ...(Option.isSome(flags.datasetId) ? { datasetId: flags.datasetId.value } : {}),
  ...(Option.isSome(flags.backendId) ? { backendId: flags.backendId.value } : {}),
});

const selectionFromRequiredDatasetFlags = (
  flags: RequiredDatasetSelectionFlags,
): DatasetCommandSelection => ({
  ...(Option.isSome(flags.datasetId) ? { datasetId: flags.datasetId.value } : {}),
  ...(Option.isSome(flags.backendId) ? { backendId: flags.backendId.value } : {}),
});

const toJson = (value: unknown) => JSON.stringify(value);

const DATASET_CLI_LIVE_SERVER_TIMEOUT = Duration.seconds(1);

type DatasetCliSource = "live" | "local";

const DatasetHttpErrorResponse = Schema.Struct({
  error: Schema.String,
  datasetError: Schema.optional(DatasetErrorDetail),
});

const isDatasetRpcError = Schema.is(DatasetRpcError);
const decodeDatasetHttpJson = HttpClientResponse.schemaBodyJson(Schema.Unknown);

const staleRuntimeStateError = () =>
  new DatasetRpcError({
    code: "unknown",
    detail:
      "Lincei server runtime was found but could not be reached; refusing to use stale dataset state.",
    actionableMessage:
      "Restart the Lincei server or remove the stale runtime state before running dataset commands.",
  });

const readDatasetErrorFromResponse = (response: HttpClientResponse.HttpClientResponse) =>
  HttpClientResponse.schemaBodyJson(DatasetHttpErrorResponse)(response).pipe(
    Effect.map((body) =>
      body.datasetError
        ? new DatasetRpcError(body.datasetError)
        : new DatasetRpcError({
            code: "unknown",
            detail: body.error,
            actionableMessage: body.error,
          }),
    ),
    Effect.catch(() =>
      Effect.succeed(
        new DatasetRpcError({
          code: "unknown",
          detail: `Dataset server request failed with status ${response.status}.`,
        }),
      ),
    ),
  );

const runLiveDatasetRequest = (
  httpClient: HttpClient.HttpClient,
  request: HttpClientRequest.HttpClientRequest,
): Effect.Effect<unknown, DatasetRpcError> =>
  Effect.gen(function* () {
    const response = yield* httpClient.execute(request);
    return yield* HttpClientResponse.matchStatus({
      "2xx": (success) =>
        decodeDatasetHttpJson(success).pipe(
          Effect.mapError(
            () =>
              new DatasetRpcError({
                code: "unknown",
                detail: "Invalid dataset server response.",
              }),
          ),
        ),
      orElse: (failed) => Effect.flatMap(readDatasetErrorFromResponse(failed), Effect.fail),
    })(response);
  }).pipe(
    Effect.timeout(DATASET_CLI_LIVE_SERVER_TIMEOUT),
    Effect.mapError((error) => (isDatasetRpcError(error) ? error : staleRuntimeStateError())),
  );

const runTypedLiveDatasetRequest = <A>(
  httpClient: HttpClient.HttpClient,
  request: HttpClientRequest.HttpClientRequest,
): Effect.Effect<A, DatasetRpcError> =>
  runLiveDatasetRequest(httpClient, request) as Effect.Effect<A, DatasetRpcError>;

const postLiveDatasetRequest = <A>(
  httpClient: HttpClient.HttpClient,
  origin: string,
  bearerToken: string,
  path: string,
  body: unknown,
): Effect.Effect<A, DatasetRpcError> =>
  HttpClientRequest.post(`${origin}${path}`).pipe(
    HttpClientRequest.acceptJson,
    HttpClientRequest.bearerToken(bearerToken),
    HttpClientRequest.bodyJson(body),
    Effect.mapError(
      () =>
        new DatasetRpcError({
          code: "unknown",
          detail: "Failed to encode dataset request body.",
        }),
    ),
    Effect.flatMap((request) => runTypedLiveDatasetRequest<A>(httpClient, request)),
  );

const selectionSearch = (selection: DatasetCommandSelection | undefined) => {
  const params = new URLSearchParams();
  if (selection?.datasetId) params.set("dataset", selection.datasetId);
  if (selection?.backendId) params.set("backend", selection.backendId);
  const query = params.toString();
  return query.length > 0 ? `?${query}` : "";
};

const makeRemoteDatasetGateway = (
  httpClient: HttpClient.HttpClient,
  origin: string,
  bearerToken: string,
): LinceiDatasetGatewayShape => ({
  resolveContext: () =>
    Effect.fail(
      new DatasetRpcError({
        code: "policy_denied",
        detail: "Remote dataset context resolution is only available through dataset context.",
      }),
    ),
  status: (input) =>
    runTypedLiveDatasetRequest(
      httpClient,
      HttpClientRequest.get(`${origin}/api/datasets/status${selectionSearch(input)}`).pipe(
        HttpClientRequest.acceptJson,
        HttpClientRequest.bearerToken(bearerToken),
      ),
    ),
  capabilities: (input) =>
    postLiveDatasetRequest(
      httpClient,
      origin,
      bearerToken,
      "/api/datasets/capabilities",
      input ?? {},
    ),
  schema: (input) =>
    postLiveDatasetRequest(httpClient, origin, bearerToken, "/api/datasets/schema", input ?? {}),
  describeTable: (input) =>
    postLiveDatasetRequest(httpClient, origin, bearerToken, "/api/datasets/describe-table", input),
  query: (input) =>
    postLiveDatasetRequest(httpClient, origin, bearerToken, "/api/datasets/query", input),
  context: (input) =>
    postLiveDatasetRequest(httpClient, origin, bearerToken, "/api/datasets/context", input ?? {}),
  runM4: () =>
    Effect.fail(
      new DatasetRpcError({
        code: "policy_denied",
        detail: "Remote M4 passthrough is not supported. Run `lincei m4` without a live server.",
        actionableMessage:
          "`lincei dataset ...` is the supported remote interface; `lincei m4` remains local-only.",
      }),
    ),
});

const withDatasetCliSessionToken = <A, E, R>(
  authControlPlane: AuthControlPlaneShape,
  run: (token: string) => Effect.Effect<A, E, R>,
) =>
  Effect.acquireUseRelease(
    authControlPlane.issueSession({
      role: "owner",
      label: "lincei dataset cli",
    }),
    (issued) => run(issued.token),
    (issued) => authControlPlane.revokeSession(issued.sessionId).pipe(Effect.ignore({ log: true })),
  );

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function inferColumns(rows: ReadonlyArray<unknown>): ReadonlyArray<string> {
  const columns = new Set<string>();
  for (const row of rows) {
    if (!isRecord(row)) continue;
    for (const key of Object.keys(row)) {
      columns.add(key);
    }
  }
  return [...columns];
}

function normalizeQueryOutput(
  result: DatasetGatewayJsonResult,
  source: DatasetCliSource,
): Record<string, unknown> {
  const raw = result.json;
  const rawRecord = isRecord(raw) ? raw : {};
  const rows = Array.isArray(rawRecord.rows) ? rawRecord.rows : Array.isArray(raw) ? raw : [];
  const columns = Array.isArray(rawRecord.columns)
    ? rawRecord.columns.map((column) => String(column))
    : inferColumns(rows);
  const explicitRowCount = rawRecord.rowCount ?? rawRecord.row_count;
  const rowCount = typeof explicitRowCount === "number" ? explicitRowCount : rows.length;

  return {
    columns,
    rows,
    rowCount,
    dataset: {
      datasetId: result.datasetId ?? null,
      backendId: result.backendId ?? null,
    },
    provenance: {
      source,
      command: result.command,
      workspacePath: result.workspacePath,
    },
  };
}

const runWithDatasetGateway = <A>(
  flags: CliAuthLocationFlags,
  run: (
    gateway: LinceiDatasetGatewayShape,
    source: DatasetCliSource,
  ) => Effect.Effect<A, DatasetRpcError>,
  options?: {
    readonly preferLiveServer?: boolean;
  },
) =>
  Effect.gen(function* () {
    const logLevel = yield* GlobalFlag.LogLevel;
    const config = yield* resolveCliAuthConfig(flags, logLevel);
    const runtimeState = yield* readPersistedServerRuntimeState(config.serverRuntimeStatePath);
    if (options?.preferLiveServer !== false && Option.isSome(runtimeState)) {
      return yield* Effect.gen(function* () {
        const authControlPlane = yield* AuthControlPlane;
        const httpClient = yield* HttpClient.HttpClient;
        return yield* withDatasetCliSessionToken(authControlPlane, (token) =>
          run(makeRemoteDatasetGateway(httpClient, runtimeState.value.origin, token), "live"),
        );
      }).pipe(
        Effect.provide(
          AuthControlPlaneRuntimeLive.pipe(
            Layer.provideMerge(FetchHttpClient.layer),
            Layer.provide(Layer.succeed(ServerConfig, config)),
            Layer.provide(Layer.succeed(References.MinimumLogLevel, config.logLevel)),
          ),
        ),
        Effect.mapError((error) => (isDatasetRpcError(error) ? error : staleRuntimeStateError())),
      );
    }

    return yield* Effect.gen(function* () {
      const gateway = yield* LinceiDatasetGateway;
      return yield* run(gateway, "local");
    }).pipe(
      Effect.provide(
        DatasetCliLive.pipe(
          Layer.provide(Layer.succeed(ServerConfig, config)),
          Layer.provide(Layer.succeed(References.MinimumLogLevel, config.logLevel)),
        ),
      ),
    );
  });

const statusCommand = Command.make("status", {
  ...authLocationFlags,
  datasetId: datasetFlag,
  backendId: backendFlag,
}).pipe(
  Command.withDescription("Show Lincei dataset runtime status."),
  Command.withHandler((flags) =>
    runWithDatasetGateway(flags, (gateway) =>
      gateway
        .status(selectionFromFlags(flags))
        .pipe(Effect.flatMap((status) => Console.log(toJson(status)))),
    ),
  ),
);

const capabilitiesCommand = Command.make("capabilities", {
  ...authLocationFlags,
  datasetId: datasetFlag,
  backendId: backendFlag,
}).pipe(
  Command.withDescription("Show M4 capabilities through Lincei's dataset gateway."),
  Command.withHandler((flags) =>
    runWithDatasetGateway(flags, (gateway) =>
      gateway
        .capabilities(selectionFromFlags(flags))
        .pipe(Effect.flatMap((result) => Console.log(toJson(result.json)))),
    ),
  ),
);

const schemaCommand = Command.make("schema", {
  ...authLocationFlags,
  datasetId: requiredDatasetFlag,
  backendId: backendFlag,
}).pipe(
  Command.withDescription("Show the schema for an explicitly selected dataset."),
  Command.withHandler((flags) =>
    runWithDatasetGateway(flags, (gateway) =>
      gateway
        .schema(selectionFromRequiredDatasetFlags(flags))
        .pipe(Effect.flatMap((result) => Console.log(toJson(result.json)))),
    ),
  ),
);

const describeTableCommand = Command.make("describe-table", {
  ...authLocationFlags,
  datasetId: requiredDatasetFlag,
  backendId: backendFlag,
  table: tableArgument,
}).pipe(
  Command.withDescription("Describe one dataset table."),
  Command.withHandler((flags) =>
    runWithDatasetGateway(flags, (gateway) =>
      gateway
        .describeTable({ ...selectionFromRequiredDatasetFlags(flags), table: flags.table })
        .pipe(Effect.flatMap((result) => Console.log(toJson(result.json)))),
    ),
  ),
);

const queryCommand = Command.make("query", {
  ...authLocationFlags,
  datasetId: requiredDatasetFlag,
  backendId: backendFlag,
  sql: sqlFlag,
}).pipe(
  Command.withDescription("Run a read-only SQL query through Lincei's dataset gateway."),
  Command.withHandler((flags) =>
    runWithDatasetGateway(flags, (gateway, source) =>
      gateway
        .query({ ...selectionFromRequiredDatasetFlags(flags), sql: flags.sql })
        .pipe(
          Effect.flatMap((result) => Console.log(toJson(normalizeQueryOutput(result, source)))),
        ),
    ),
  ),
);

const contextCommand = Command.make("context", {
  ...authLocationFlags,
  datasetId: datasetFlag,
  backendId: backendFlag,
  structured: structuredFlag,
}).pipe(
  Command.withDescription("Emit dataset context suitable for agent prompts."),
  Command.withHandler((flags) =>
    runWithDatasetGateway(flags, (gateway) =>
      gateway
        .context(selectionFromFlags(flags))
        .pipe(
          Effect.flatMap((context) =>
            Console.log(flags.structured ? toJson(context) : formatDatasetContextMarkdown(context)),
          ),
        ),
    ),
  ),
);

export const datasetCommand = Command.make("dataset").pipe(
  Command.withDescription("Use Lincei-managed clinical datasets through the M4 gateway."),
  Command.withSubcommands([
    statusCommand,
    capabilitiesCommand,
    schemaCommand,
    describeTableCommand,
    queryCommand,
    contextCommand,
  ]),
);

export const m4Command = Command.make("m4", {
  ...authLocationFlags,
  args: m4ArgsArgument,
}).pipe(
  Command.withDescription("Advanced: run M4 through Lincei's configured dataset gateway."),
  Command.withHandler((flags) =>
    runWithDatasetGateway(
      flags,
      (gateway) =>
        gateway.runM4(flags.args).pipe(
          Effect.flatMap((result) =>
            Effect.gen(function* () {
              if (result.stdout.length > 0) {
                yield* Console.log(result.stdout.trimEnd());
              }
              if (result.stderr.length > 0) {
                yield* Console.error(result.stderr.trimEnd());
              }
            }),
          ),
        ),
      { preferLiveServer: false },
    ),
  ),
);
