import type {
  ClinicalDataset,
  ClinicalDatasetJob,
  ClinicalRuntimeStatus,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import upstreamWizard from "../components/onboarding/WelcomeWizard.tsx?raw";

import {
  clinicalSetupAction,
  clinicalSetupUnsettled,
  clinicalStepFooter,
  clinicalStepStates,
  clinicalToolsInstalled,
  connectionProtectsSecrets,
  datasetDisplayName,
  datasetFacts,
  datasetGroup,
  datasetIdFromTitle,
  describeRemoval,
  describeDataset,
  describeJobProgress,
  describeLostConnection,
  folderPathProblem,
  formatBytes,
  WIZARD_STAGES,
  withDatasetName,
} from "./clinicalPresentation";

const status = (fields: Partial<ClinicalRuntimeStatus>): ClinicalRuntimeStatus => ({
  state: "not-installed",
  message: "",
  home: "",
  python: "",
  skillsDir: "",
  dataDir: "",
  requirements: [],
  demoDataset: "not-installed",
  ...fields,
});

const statesOf = (fields: Partial<ClinicalRuntimeStatus>) =>
  clinicalStepStates(status(fields)).map(({ state }) => state);

describe("clinicalStepStates", () => {
  it("marks the steps before the running one done and the rest pending", () => {
    expect(statesOf({ state: "installing", step: "packages" })).toEqual([
      "done",
      "done",
      "active",
      "pending",
      "pending",
    ]);
  });

  it("marks the step setup stopped at as failed", () => {
    expect(statesOf({ state: "failed", step: "python" })).toEqual([
      "done",
      "failed",
      "pending",
      "pending",
      "pending",
    ]);
  });

  it("shows a ready environment whose demo download failed as done except the demo", () => {
    expect(statesOf({ state: "ready", demoDataset: "failed" })).toEqual([
      "done",
      "done",
      "done",
      "done",
      "failed",
    ]);
  });
});

describe("describeJobProgress", () => {
  const job = (fields: Partial<ClinicalDatasetJob>): ClinicalDatasetJob => ({
    kind: "download",
    state: "running",
    phase: "downloading",
    completed: 0,
    message: "Downloading the raw files.",
    ...fields,
  });

  it("counts the file in transfer toward the phase", () => {
    const progress = describeJobProgress(
      job({
        completed: 1,
        total: 4,
        file: { name: "labevents.csv.gz", bytes: 512 * 1024 ** 2, totalBytes: 1024 ** 3 },
      }),
    );
    expect(progress.label).toBe("Downloading file 2 of 4 (labevents.csv.gz, 512 MB of 1.0 GB)");
    expect(progress.fraction).toBeCloseTo(0.375);
  });

  it("has no bar before M4 knows how much there is to do", () => {
    expect(describeJobProgress(job({}))).toEqual({
      label: "Downloading the raw files.",
      fraction: null,
    });
  });

  it("never names a file beyond the last one", () => {
    expect(describeJobProgress(job({ completed: 4, total: 4 })).label).toBe(
      "Downloading file 4 of 4",
    );
  });
});

describe("WIZARD_STAGES", () => {
  it("reads the same as the header of the wizard's first three steps", () => {
    const list = WIZARD_STAGES.map((stage) => JSON.stringify(stage)).join(", ");
    expect(upstreamWizard).toContain(`const ONBOARDING_STAGES = [${list}] as const;`);
  });
});

describe("clinicalToolsInstalled", () => {
  it("counts the tools as installed while only the demo is still downloading", () => {
    expect(clinicalToolsInstalled(status({ state: "ready" }))).toBe(true);
    expect(clinicalToolsInstalled(status({ state: "installing", step: "dataset" }))).toBe(true);
    expect(clinicalToolsInstalled(status({ state: "installing", step: "packages" }))).toBe(false);
    expect(clinicalToolsInstalled(status({ state: "failed", step: "dataset" }))).toBe(false);
  });
});

describe("clinicalSetupAction", () => {
  it("offers the step that moves setup on, and nothing while it runs or is done", () => {
    expect(clinicalSetupAction(status({ state: "not-installed" }))).toBe("Set up");
    expect(clinicalSetupAction(status({ state: "failed", step: "python" }))).toBe("Try again");
    expect(clinicalSetupAction(status({ state: "installing", step: "uv" }))).toBeNull();
    expect(clinicalSetupAction(status({ state: "ready", demoDataset: "ready" }))).toBeNull();
  });

  it("offers the demo again when only its download failed", () => {
    expect(clinicalSetupAction(status({ state: "ready", demoDataset: "failed" }))).toBe(
      "Retry the demo download",
    );
  });

  it("offers another try when tools that work could not be updated", () => {
    const updateFailed = status({ state: "ready", demoDataset: "ready", step: "packages" });
    expect(clinicalSetupAction(updateFailed)).toBe("Try again");
    expect(clinicalSetupUnsettled(updateFailed)).toBe(true);
    expect(statesOf({ state: "ready", demoDataset: "ready", step: "packages" })).toEqual([
      "done",
      "done",
      "failed",
      "done",
      "done",
    ]);
  });

  it("has nothing more to show once everything is in place", () => {
    expect(clinicalSetupUnsettled(status({ state: "ready", demoDataset: "ready" }))).toBe(false);
    expect(clinicalSetupUnsettled(status({ state: "installing", step: "uv" }))).toBe(true);
  });
});

describe("clinicalStepFooter", () => {
  const footer = (fields: Partial<ClinicalRuntimeStatus>) =>
    clinicalStepFooter({ phase: "known", status: status(fields) });

  it("promises that setup keeps running only while it runs", () => {
    expect(footer({ state: "installing", step: "packages" })).toContain("keeps running");
    for (const stopped of [
      footer({ state: "failed", step: "packages" }),
      footer({ state: "not-installed" }),
      footer({ state: "ready", demoDataset: "failed" }),
      clinicalStepFooter({ phase: "loading" }),
      clinicalStepFooter({ phase: "failed", message: "No answer.", detail: null }),
    ]) {
      expect(stopped).not.toContain("keep");
    }
  });

  it("says what stopped and where to pick it up", () => {
    expect(footer({ state: "failed", step: "packages" })).toBe(
      "Setup stopped. Try again here, or later under Settings, Clinical Data.",
    );
    expect(footer({ state: "ready", demoDataset: "failed" })).toBe(
      "The demo dataset is missing. Retry here, or later under Settings, Clinical Data.",
    );
  });
});

const dataset = (fields: Partial<ClinicalDataset>): ClinicalDataset => ({
  name: "mimic-iv",
  state: "missing",
  requiresCredentials: false,
  downloadable: true,
  ...fields,
});

describe("datasetDisplayName", () => {
  it("uses M4's title, and M4's id where there is none", () => {
    expect(datasetDisplayName({ name: "mimic-iv", title: "MIMIC-IV" })).toBe("MIMIC-IV");
    expect(datasetDisplayName({ name: "my-registry" })).toBe("my-registry");
  });
});

describe("withDatasetName", () => {
  const mimic = { name: "mimic-iv", title: "MIMIC-IV" };

  it("names the dataset in a sentence the server wrote with its id", () => {
    expect(withDatasetName("This account has no access to mimic-iv yet.", mimic)).toBe(
      "This account has no access to MIMIC-IV yet.",
    );
    expect(
      withDatasetName("eicu is already being prepared.", { name: "eicu", title: "eICU" }),
    ).toBe("eICU is already being prepared.");
  });

  it("leaves longer ids, paths, and datasets without a title as they are", () => {
    expect(withDatasetName("Preparing mimic-iv-note did not finish.", mimic)).toBe(
      "Preparing mimic-iv-note did not finish.",
    );
    expect(withDatasetName("Looked in /data/mimic-iv/hosp.", mimic)).toBe(
      "Looked in /data/mimic-iv/hosp.",
    );
    expect(withDatasetName("Preparing my-registry did not finish.", { name: "my-registry" })).toBe(
      "Preparing my-registry did not finish.",
    );
  });
});

describe("describeDataset", () => {
  it("says where a dataset is, or is not, in the reader's words", () => {
    expect(describeDataset(dataset({ state: "ready", sizeGb: 6.26 }))).toBe(
      "Ready to query. 6.3 GB on this computer.",
    );
    expect(describeDataset(dataset({ state: "ready", sizeGb: 6.26 }), "lab-server")).toBe(
      "Ready to query. 6.3 GB on lab-server.",
    );
    expect(describeDataset(dataset({}))).toBe("Not on this computer.");
  });

  it("says how to finish one that is partly there", () => {
    expect(describeDataset(dataset({ state: "incomplete" }))).toBe(
      "Partly prepared. Finish adding it to make it ready.",
    );
  });
});

describe("datasetGroup", () => {
  const job = (state: ClinicalDatasetJob["state"]): ClinicalDatasetJob => ({
    kind: "download",
    state,
    phase: "downloading",
    completed: 0,
    message: "",
  });

  it("lists what a computer has or is getting apart from what can be added", () => {
    expect(datasetGroup(dataset({ state: "ready" }))).toBe("present");
    expect(datasetGroup(dataset({ state: "incomplete" }))).toBe("present");
    expect(datasetGroup(dataset({ job: job("running") }))).toBe("present");
    expect(datasetGroup(dataset({}))).toBe("available");
  });

  it("leaves a download that failed before anything arrived with what can be added", () => {
    expect(datasetGroup(dataset({ job: job("failed") }))).toBe("available");
    expect(datasetGroup(dataset({ state: "incomplete", job: job("failed") }))).toBe("present");
  });
});

describe("datasetFacts", () => {
  it("gives the download's size and the version where M4 knows them", () => {
    expect(datasetFacts(dataset({ downloadSizeGb: 9.6, version: "3.1" }))).toEqual([
      "About 9.6 GB to download",
      "Version 3.1",
    ]);
    expect(datasetFacts(dataset({}))).toEqual([]);
  });
});

describe("describeRemoval", () => {
  it("says the folder a dataset of the user's own came from stays", () => {
    const removal = describeRemoval(
      dataset({ name: "registry", title: "ICU registry", custom: true, state: "ready", sizeGb: 2 }),
    );
    expect(removal.title).toBe("Remove ICU registry?");
    expect(removal.description).toContain("ICU registry (2.0 GB) on this computer");
    expect(removal.description).toContain("The folder you added it from stays as it is.");
  });

  it("says a dataset M4 ships can be added again", () => {
    const removal = describeRemoval(dataset({ title: "MIMIC-IV", state: "ready" }), "lab-server");
    expect(removal.description).toBe(
      "Lincei deletes the files of MIMIC-IV from lab-server. Agents can no longer query it until you add it again.",
    );
  });
});

describe("datasetIdFromTitle", () => {
  it("makes an id M4 accepts from what a person calls the dataset", () => {
    expect(datasetIdFromTitle("ICU Registry 2024")).toBe("icu-registry-2024");
    expect(datasetIdFromTitle("  Sepsis cohort (v2)! ")).toBe("sepsis-cohort-v2");
    expect(datasetIdFromTitle("Kliniken Köln – Intensivstation")).toBe(
      "kliniken-koln-intensivstation",
    );
  });

  it("is empty when nothing in the name can become an id", () => {
    expect(datasetIdFromTitle("集中治療")).toBe("");
    expect(datasetIdFromTitle("---")).toBe("");
  });

  it("never ends in a dash where it is cut short", () => {
    expect(datasetIdFromTitle(`${"a".repeat(59)} b`)).toBe("a".repeat(59));
  });
});

describe("folderPathProblem", () => {
  it("takes a full path on any system", () => {
    expect(folderPathProblem("/Users/ada/Downloads/mimic-iv")).toBeNull();
    expect(folderPathProblem("C:\\data\\mimic-iv")).toBeNull();
    expect(folderPathProblem("\\\\server\\share\\mimic-iv")).toBeNull();
  });

  it("explains a path the server would only call missing", () => {
    expect(folderPathProblem("~/Downloads/mimic-iv")).toContain("instead of ~");
    expect(folderPathProblem("Downloads/mimic-iv")).toContain("full path");
  });
});

describe("describeLostConnection", () => {
  it("speaks of a background service on this computer, and what to do if it stays", () => {
    const lost = describeLostConnection({ otherComputer: null, reconnecting: true });
    expect(lost.title).toBe("Lincei lost the connection to its background service");
    expect(lost.detail).toContain("Lincei is reconnecting");
    expect(lost.detail).toContain("quit Lincei and open it again");
  });

  it("does not claim to be reconnecting once it has given up", () => {
    const lost = describeLostConnection({ otherComputer: null, reconnecting: false });
    expect(lost.detail).not.toContain("is reconnecting");
    expect(lost.detail).toContain("Reconnect below");
  });

  it("names another computer instead of a service nobody there has seen", () => {
    const lost = describeLostConnection({ otherComputer: "lab-server", reconnecting: true });
    expect(lost.title).toBe("Lincei lost the connection to lab-server");
    expect(lost.detail).toContain("check that lab-server is on");
  });
});

describe("formatBytes", () => {
  it("keeps one decimal below a hundred of a unit", () => {
    expect(formatBytes(900)).toBe("900 B");
    expect(formatBytes(6.26 * 1024 ** 3)).toBe("6.3 GB");
    expect(formatBytes(250 * 1024 ** 2)).toBe("250 MB");
  });
});

describe("connectionProtectsSecrets", () => {
  it("allows this machine and encrypted connections", () => {
    expect(connectionProtectsSecrets("http://127.0.0.1:3773/")).toBe(true);
    expect(connectionProtectsSecrets("http://localhost:3773")).toBe(true);
    expect(connectionProtectsSecrets("https://lab-server.tailnet.ts.net")).toBe(true);
  });

  it("refuses plain HTTP to another machine, and anything it cannot read", () => {
    expect(connectionProtectsSecrets("http://192.168.1.20:3773")).toBe(false);
    expect(connectionProtectsSecrets("http://lab-server.local:3773")).toBe(false);
    expect(connectionProtectsSecrets("not a url")).toBe(false);
    expect(connectionProtectsSecrets(null)).toBe(false);
  });
});
