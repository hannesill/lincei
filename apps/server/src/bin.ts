import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import { Command } from "effect/unstable/cli";

import { authCommand } from "./cli/auth.ts";
import { sharedServerCommandFlags } from "./cli/config.ts";
import { datasetCommand, m4Command } from "./cli/dataset.ts";
import { projectCommand } from "./cli/project.ts";
import { runCliMain } from "./cli/root.ts";
import { runServerCommand, serveCommand, startCommand } from "./cli/server.ts";

export const adminCli = Command.make("t3", { ...sharedServerCommandFlags }).pipe(
  Command.withDescription("Run the Lincei server."),
  Command.withHandler((flags) => runServerCommand(flags)),
  Command.withSubcommands([
    startCommand,
    serveCommand,
    authCommand,
    projectCommand,
    datasetCommand,
    m4Command,
  ]),
);

export const cli = adminCli;

if (import.meta.main) {
  runCliMain(adminCli).pipe(NodeRuntime.runMain);
}
