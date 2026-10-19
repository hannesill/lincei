import {
  ClinicalImageRequest,
  ClinicalRuntimeStatus,
  OrchestratorMcpFailure,
} from "@t3tools/contracts";
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

const imageRequestShared = { ...shared, success: ClinicalImageRequest };

const FetchImagesTool = Tool.make("lincei_clinical_fetch_images", {
  ...imageRequestShared,
  description:
    "Ask Lincei to fetch a cohort's images from an imaging dataset such as MIMIC-CXR-JPG, whose images are fetched per cohort rather than downloaded whole. Write the cohort to a CSV file in this conversation's folder, one row per image with a dicom_id (or image_path) column, at most 1000 rows, and pass its full path; Lincei fetches the list as it is when you call, so changing the file later changes nothing. For a credentialed dataset Lincei asks the user, in this conversation, to sign in with PhysioNet; never ask for their password yourself. Returns the request at once: `done` when every image is already on this computer, otherwise state `waiting-for-login`, then `fetching`, then `done`, `declined`, or `failed`. Tell the user to sign in where Lincei asks, then follow the request with lincei_clinical_image_request. Fetching can take hours for hundreds of images. Read the images' paths with M4 (`m4.local_image_paths(dataset, cohort)`, m4-api skill).",
  parameters: Schema.Struct({
    dataset: Schema.String.annotate({
      description: "M4's name for the dataset, e.g. mimic-cxr-jpg.",
    }),
    cohort_csv: Schema.String.annotate({
      description:
        "Full path of the CSV file listing the images, with a dicom_id or image_path column.",
    }),
  }),
})
  .annotate(Tool.Title, "Fetch a cohort's images")
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false);

const ImageRequestTool = Tool.make("lincei_clinical_image_request", {
  ...imageRequestShared,
  description:
    "Read where an image request from lincei_clinical_fetch_images stands: its state, how many images are fetched so far (`completed` of `total`), and `message`, which is written for the user. A `failed` request says what went wrong; the user can sign in to it again. `declined` means the user turned it down or stopped the fetch; images that had arrived stay.",
  parameters: Schema.Struct({
    request_id: Schema.String.annotate({
      description: "The `id` lincei_clinical_fetch_images returned.",
    }),
  }),
})
  .annotate(Tool.Title, "Get an image request")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true);

export const ClinicalToolkit = Toolkit.make(
  ClinicalStatusTool,
  ClinicalSetupTool,
  FetchImagesTool,
  ImageRequestTool,
);
