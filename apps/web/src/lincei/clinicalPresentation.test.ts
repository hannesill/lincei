import type { ClinicalDatasetJob, ClinicalRuntimeStatus } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  clinicalStepStates,
  connectionProtectsSecrets,
  describeJobProgress,
  formatBytes,
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
