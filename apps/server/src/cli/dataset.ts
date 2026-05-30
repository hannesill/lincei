import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as References from "effect/References";
import { Argument, Command, Flag, GlobalFlag } from "effect/unstable/cli";

import {
  DATASET_BACKEND_IDS,
  DATASET_IDS,
  type DatasetBackendId,
  type DatasetId,
  type DatasetRpcError,
} from "@t3tools/contracts";

import { ServerSecretStoreLive } from "../auth/Layers/ServerSecretStore.ts";
import { ServerConfig } from "../config.ts";
import * as LinceiDatasetGatewayLayer from "../datasets/LinceiDatasetGateway.ts";
import {
  formatDatasetContextMarkdown,
  LinceiDatasetGateway,
  type DatasetCommandSelection,
  type LinceiDatasetGatewayShape,
} from "../datasets/LinceiDatasetGateway.ts";
import * as M4CliLayer from "../datasets/M4Cli.ts";
import * as M4DatasetServiceLayer from "../datasets/M4DatasetService.ts";
import { layer as ProcessRunnerLive } from "../processRunner.ts";
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

const backendFlag = Flag.choice("backend", DATASET_BACKEND_IDS).pipe(
  Flag.withDescription("Dataset backend for this command."),
  Flag.optional,
);

const contextFormatFlag = Flag.choice("format", ["markdown", "json"] as const).pipe(
  Flag.withDescription("Output format for dataset context."),
  Flag.withDefault("markdown"),
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

const selectionFromFlags = (flags: DatasetSelectionFlags): DatasetCommandSelection => ({
  ...(Option.isSome(flags.datasetId) ? { datasetId: flags.datasetId.value } : {}),
  ...(Option.isSome(flags.backendId) ? { backendId: flags.backendId.value } : {}),
});

const toJson = (value: unknown) => JSON.stringify(value, null, 2);

const runWithDatasetGateway = <A>(
  flags: CliAuthLocationFlags,
  run: (gateway: LinceiDatasetGatewayShape) => Effect.Effect<A, DatasetRpcError>,
) =>
  Effect.gen(function* () {
    const logLevel = yield* GlobalFlag.LogLevel;
    const config = yield* resolveCliAuthConfig(flags, logLevel);
    return yield* Effect.gen(function* () {
      const gateway = yield* LinceiDatasetGateway;
      return yield* run(gateway);
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
  datasetId: datasetFlag,
  backendId: backendFlag,
}).pipe(
  Command.withDescription("Show the active dataset schema."),
  Command.withHandler((flags) =>
    runWithDatasetGateway(flags, (gateway) =>
      gateway
        .schema(selectionFromFlags(flags))
        .pipe(Effect.flatMap((result) => Console.log(toJson(result.json)))),
    ),
  ),
);

const describeTableCommand = Command.make("describe-table", {
  ...authLocationFlags,
  datasetId: datasetFlag,
  backendId: backendFlag,
  table: tableArgument,
}).pipe(
  Command.withDescription("Describe one dataset table."),
  Command.withHandler((flags) =>
    runWithDatasetGateway(flags, (gateway) =>
      gateway
        .describeTable({ ...selectionFromFlags(flags), table: flags.table })
        .pipe(Effect.flatMap((result) => Console.log(toJson(result.json)))),
    ),
  ),
);

const queryCommand = Command.make("query", {
  ...authLocationFlags,
  datasetId: datasetFlag,
  backendId: backendFlag,
  sql: sqlFlag,
}).pipe(
  Command.withDescription("Run a read-only SQL query through Lincei's dataset gateway."),
  Command.withHandler((flags) =>
    runWithDatasetGateway(flags, (gateway) =>
      gateway
        .query({ ...selectionFromFlags(flags), sql: flags.sql })
        .pipe(Effect.flatMap((result) => Console.log(toJson(result.json)))),
    ),
  ),
);

const contextCommand = Command.make("context", {
  ...authLocationFlags,
  datasetId: datasetFlag,
  backendId: backendFlag,
  format: contextFormatFlag,
}).pipe(
  Command.withDescription("Emit dataset context suitable for agent prompts."),
  Command.withHandler((flags) =>
    runWithDatasetGateway(flags, (gateway) =>
      gateway
        .context(selectionFromFlags(flags))
        .pipe(
          Effect.flatMap((context) =>
            Console.log(
              flags.format === "json" ? toJson(context) : formatDatasetContextMarkdown(context),
            ),
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
    runWithDatasetGateway(flags, (gateway) =>
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
    ),
  ),
);
