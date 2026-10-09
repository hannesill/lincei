import { OrchestratorMcpFailure } from "@t3tools/contracts";
import { Tool, Toolkit } from "effect/ai";

import * as McpInvocationContext from "../../mcp/McpInvocationContext.ts";
import * as ThreadManagementService from "../../orchestration-v2/ThreadManagementService.ts";
import * as ClinicalRuntime from "../ClinicalRuntime.ts";

const shared = {
  success: ClinicalRuntime.ClinicalRuntimeStatus,
  failure: OrchestratorMcpFailure,
  failureMode: "return" as const,
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagementService.ThreadManagementService,
    ClinicalRuntime.ClinicalRuntime,
  ],
};

const ClinicalStatusTool = Tool.make("lincei_clinical_status", {
  ...shared,
  description:
    "Report the state of Lincei's managed clinical Python environment (M4 for clinical datasets, Vitrine for research cards): whether it is installed, the setup step in progress or the one that failed, and where its Python, skills, and datasets live. Call this when `m4` or `vitrine` is missing, or to follow a setup started with lincei_clinical_setup.",
})
  .annotate(Tool.Title, "Get clinical runtime status")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true);

const ClinicalSetupTool = Tool.make("lincei_clinical_setup", {
  ...shared,
  description:
    "Install or repair Lincei's managed clinical Python environment in the background and return its status immediately. Setup needs `uv` and network access and can take a few minutes on first run; poll lincei_clinical_status until state is ready or failed. Safe to call when already installed.",
})
  .annotate(Tool.Title, "Set up clinical runtime")
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true);

export const ClinicalToolkit = Toolkit.make(ClinicalStatusTool, ClinicalSetupTool);
