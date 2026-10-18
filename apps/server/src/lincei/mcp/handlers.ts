import {
  type ClinicalImageRequest,
  type ClinicalRuntimeStatus,
  OrchestratorMcpFailure,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import * as McpInvocationContext from "../../mcp/McpInvocationContext.ts";
import * as McpToolAccess from "../../mcp/McpToolAccess.ts";
import * as ClinicalImageRequests from "../ClinicalImageRequests.ts";
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

/**
 * Asks the image requests, read as an optional service like the runtime. An
 * error comes back as the tool's failure, with its message for the agent.
 */
const askImageRequests = (
  ask: (
    requests: typeof ClinicalImageRequests.ClinicalImageRequests.Service,
  ) => Effect.Effect<ClinicalImageRequest, ClinicalImageRequests.ClinicalImageRequestsError>,
): Effect.Effect<ClinicalImageRequest, OrchestratorMcpFailure> =>
  Effect.flatMap(
    Effect.serviceOption(ClinicalImageRequests.ClinicalImageRequests),
    Option.match({
      onNone: () =>
        Effect.fail(
          new OrchestratorMcpFailure({
            code: "invalid_request",
            message: "This server has no clinical research tools.",
          }),
        ),
      onSome: (requests) =>
        ask(requests).pipe(
          Effect.mapError(
            (error) =>
              new OrchestratorMcpFailure({ code: "invalid_request", message: error.message }),
          ),
        ),
    }),
  );

export const layer = McpToolAccess.toLayer(ClinicalToolkit, {
  lincei_clinical_status: McpToolAccess.reads(() =>
    askClinicalRuntime((runtime) => runtime.status),
  ),
  lincei_clinical_setup: McpToolAccess.writes(
    ({ force }: { readonly force?: boolean | undefined }) =>
      askClinicalRuntime((runtime) => runtime.setup({ force })),
  ),
  // Shown in the calling thread, so only an agent in a thread can ask.
  lincei_clinical_fetch_images: McpToolAccess.actsAsCaller(
    ({ dataset, cohort_csv }: { readonly dataset: string; readonly cohort_csv: string }) =>
      McpInvocationContext.McpInvocationContext.pipe(
        Effect.flatMap(({ thread }) =>
          thread === undefined
            ? Effect.fail(
                new OrchestratorMcpFailure({
                  code: "thread_credential_required",
                  message: "Only an agent in a Lincei thread can request images.",
                }),
              )
            : askImageRequests((requests) =>
                requests.request({ threadId: thread.threadId, dataset, list: cohort_csv }),
              ),
        ),
      ),
  ),
  lincei_clinical_image_request: McpToolAccess.reads(
    ({ request_id }: { readonly request_id: string }) =>
      askImageRequests((requests) =>
        requests.get(request_id).pipe(
          Effect.flatMap(
            Option.match({
              onNone: () =>
                Effect.fail(
                  new ClinicalImageRequests.ClinicalImageRequestsError({
                    message: `There is no image request ${request_id}. Requests are kept until Lincei restarts, and finished ones for an hour.`,
                  }),
                ),
              onSome: Effect.succeed,
            }),
          ),
        ),
      ),
  ),
});
