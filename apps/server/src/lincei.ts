import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import { Command } from "effect/unstable/cli";

import { contextCommand } from "./cli/agent.ts";
import { datasetCommand, m4Command } from "./cli/dataset.ts";
import { runCliMain } from "./cli/root.ts";

export const agentCli = Command.make("lincei").pipe(
  Command.withDescription("Run Lincei project and dataset operations."),
  Command.withSubcommands([contextCommand, datasetCommand, m4Command]),
);

if (import.meta.main) {
  runCliMain(agentCli).pipe(NodeRuntime.runMain);
}
