import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import { Command } from "effect/unstable/cli";

import { cardCommand, contextCommand } from "./cli/agent.ts";
import { runCliMain } from "./cli/root.ts";

export const agentCli = Command.make("lincei").pipe(
  Command.withDescription("Run Lincei research operations."),
  Command.withSubcommands([cardCommand, contextCommand]),
);

if (import.meta.main) {
  runCliMain(agentCli).pipe(NodeRuntime.runMain);
}
