import type { ClinicalRuntimeStatus } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import * as McpToolAccess from "../../mcp/McpToolAccess.ts";
import * as ClinicalRuntime from "../ClinicalRuntime.ts";
import { ClinicalToolkit } from "./tools.ts";

/** What the tools answer on a server that has no clinical runtime. */
const NO_CLINICAL_TOOLS: ClinicalRuntimeStatus = {
  state: "not-installed",
  message: "This server has no clinical research tools.",
  home: "",
  python: "",
  skillsDir: "",
  dataDir: "",
  requirements: [],
  demoDataset: "not-installed",
};

/**
 * Asks the clinical runtime, when the server has one. The runtime is read as
 * an optional service so that it stays out of the requirements of upstream's
 * `McpHttpServer.layer`: upstream's own tests assemble that layer from the
 * services upstream knows, and must keep compiling and passing without Lincei.
 */
export const askClinicalRuntime = (
  ask: (
    runtime: typeof ClinicalRuntime.ClinicalRuntime.Service,
  ) => Effect.Effect<ClinicalRuntimeStatus>,
): Effect.Effect<ClinicalRuntimeStatus> =>
  Effect.flatMap(
    Effect.serviceOption(ClinicalRuntime.ClinicalRuntime),
    Option.match({ onNone: () => Effect.succeed(NO_CLINICAL_TOOLS), onSome: ask }),
  );

export const layer = McpToolAccess.toLayer(ClinicalToolkit, {
  lincei_clinical_status: McpToolAccess.reads(() =>
    askClinicalRuntime((runtime) => runtime.status),
  ),
  lincei_clinical_setup: McpToolAccess.writes(
    ({ force }: { readonly force?: boolean | undefined }) =>
      askClinicalRuntime((runtime) => runtime.setup({ force })),
  ),
});
