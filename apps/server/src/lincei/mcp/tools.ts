import { ClinicalRuntimeStatus, OrchestratorMcpFailure } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";

import * as McpInvocationContext from "../../mcp/McpInvocationContext.ts";
import * as ThreadManagementService from "../../orchestration-v2/ThreadManagementService.ts";

const shared = {
  success: ClinicalRuntimeStatus,
  failure: OrchestratorMcpFailure,
  failureMode: "return" as const,
  // Not the clinical runtime: the handlers read it as an optional service, so
  // that upstream's MCP server layer requires nothing of Lincei's (handlers.ts).
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagementService.ThreadManagementService,
  ],
};

const ClinicalStatusTool = Tool.make("lincei_clinical_status", {
  ...shared,
  description:
    "Report the state of Lincei's clinical research tools (M4 for clinical datasets and Vitrine for research cards, in a Python environment Lincei manages): whether they are installed, the setup step in progress or the one that failed, and where their Python, skills, and datasets live. `message` is written for the user, so pass it on as it is; `detail` is command output for you. Call this when `m4` or `vitrine` is missing, or to follow a setup started with lincei_clinical_setup.",
})
  .annotate(Tool.Title, "Get the state of the clinical research tools")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true);

const ClinicalSetupTool = Tool.make("lincei_clinical_setup", {
  ...shared,
  description:
    "Install, update, or complete Lincei's clinical research tools in the background, and return the state of that run at once: `installing` when it has something to do, `ready` when everything is already there. Lincei brings everything it needs; setup needs network access and takes several minutes on first run. Poll lincei_clinical_status while state is `installing`. `failed` is the end of that run, not of setup: tell the user what `message` says, and call this tool again to retry. Safe to call when already installed.",
  parameters: Schema.Struct({
    force: Schema.optional(
      Schema.Boolean.annotate({
        description:
          "Install everything again, to repair tools that are installed but do not work (for example after a package was removed from Lincei's Python environment). Leave it out otherwise: it downloads every package again.",
      }),
    ),
  }),
})
  .annotate(Tool.Title, "Set up the clinical research tools")
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true);

export const ClinicalToolkit = Toolkit.make(ClinicalStatusTool, ClinicalSetupTool);
