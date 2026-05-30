import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as Option from "effect/Option";
import { Command } from "effect/unstable/cli";

import { authCommand } from "./cli/auth.ts";
import { sharedServerCommandFlags } from "./cli/config.ts";
import { projectCommand } from "./cli/project.ts";
import { runCliMain } from "./cli/root.ts";
import { runServerCommand, serveCommand, startCommand } from "./cli/server.ts";

const { cwd: _cwdFlag, ...adminRootServerCommandFlags } = sharedServerCommandFlags;

export const adminCli = Command.make("t3", { ...adminRootServerCommandFlags }).pipe(
  Command.withDescription("Run the Lincei server."),
  Command.withHandler((flags) => runServerCommand({ ...flags, cwd: Option.none() })),
  Command.withSubcommands([startCommand, serveCommand, authCommand, projectCommand]),
);

export const cli = adminCli;

if (import.meta.main) {
  runCliMain(adminCli).pipe(NodeRuntime.runMain);
}
