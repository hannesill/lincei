import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import { Command } from "effect/unstable/cli";

import { cardCommand, contextCommand, decisionCommand } from "./cli/agent.ts";
import { datasetCommand, m4Command } from "./cli/dataset.ts";
import { runCliMain } from "./cli/root.ts";
import { artifactCommand, runCommand, studyCommand } from "./cli/study.ts";

export const agentCli = Command.make("lincei").pipe(
  Command.withDescription("Run Lincei research operations."),
  Command.withSubcommands([
    cardCommand,
    decisionCommand,
    contextCommand,
    artifactCommand,
    studyCommand,
    runCommand,
    datasetCommand,
    m4Command,
  ]),
);

if (import.meta.main) {
  runCliMain(agentCli).pipe(NodeRuntime.runMain);
}
