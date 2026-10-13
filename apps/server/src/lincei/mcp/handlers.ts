import * as Effect from "effect/Effect";

import * as McpToolAccess from "../../mcp/McpToolAccess.ts";
import * as ClinicalRuntime from "../ClinicalRuntime.ts";
import { ClinicalToolkit } from "./tools.ts";

export const layer = McpToolAccess.toLayer(ClinicalToolkit, {
  lincei_clinical_status: McpToolAccess.reads(() =>
    Effect.flatMap(ClinicalRuntime.ClinicalRuntime, (runtime) => runtime.status),
  ),
  lincei_clinical_setup: McpToolAccess.writes(
    ({ force }: { readonly force?: boolean | undefined }) =>
      Effect.flatMap(ClinicalRuntime.ClinicalRuntime, (runtime) => runtime.setup({ force })),
  ),
});
