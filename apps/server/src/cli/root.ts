import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NetService from "@t3tools/shared/Net";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { Command } from "effect/unstable/cli";

import packageJson from "../../package.json" with { type: "json" };

export const CliRuntimeLayer = Layer.mergeAll(NodeServices.layer, NetService.layer);

export const runCliMain = <Name extends string, Args, Config, E, R>(
  cli: Command.Command<Name, Args, Config, E, R>,
) =>
  Command.run(cli, { version: packageJson.version }).pipe(
    Effect.scoped,
    Effect.provide(CliRuntimeLayer),
  );
