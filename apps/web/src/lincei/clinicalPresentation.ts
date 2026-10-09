/**
 * How the clinical environment's setup and its datasets' jobs read to a
 * person: which setup steps are behind us, how far a job is, and what to call
 * the state a dataset is in.
 */
import type {
  ClinicalDataset,
  ClinicalDatasetJob,
  ClinicalProvisionStep,
  ClinicalRuntimeStatus,
} from "@t3tools/contracts";

export type ClinicalStepState = "done" | "active" | "failed" | "pending";

/** Setup's steps in the order they run. */
export const CLINICAL_SETUP_STEPS: ReadonlyArray<{
  readonly step: ClinicalProvisionStep;
  readonly label: string;
}> = [
  { step: "uv", label: "Python installer" },
  { step: "python", label: "Python environment" },
  { step: "packages", label: "M4 and Vitrine" },
  { step: "skills", label: "Clinical skills" },
  { step: "dataset", label: "MIMIC-IV demo data" },
];

/** Where each setup step stands, given the one the status names. */
export function clinicalStepStates(
  status: ClinicalRuntimeStatus,
): ReadonlyArray<{ readonly step: ClinicalProvisionStep; readonly state: ClinicalStepState }> {
  const current = CLINICAL_SETUP_STEPS.findIndex(({ step }) => step === status.step);
  return CLINICAL_SETUP_STEPS.map(({ step }, index) => {
    if (status.state === "ready") {
      // The environment is usable without the demo, so only that step can have failed.
      const demoFailed = step === "dataset" && status.demoDataset === "failed";
      return { step, state: demoFailed ? "failed" : "done" };
    }
    if (status.state === "not-installed" || current === -1) return { step, state: "pending" };
    if (index < current) return { step, state: "done" };
    if (index > current) return { step, state: "pending" };
    return { step, state: status.state === "failed" ? "failed" : "active" };
  });
}

const UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

export function formatBytes(bytes: number): string {
  let value = Math.max(0, bytes);
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${unit === 0 || value >= 100 ? Math.round(value) : value.toFixed(1)} ${UNITS[unit]}`;
}

/** What a dataset's row says when no job is running on it. */
export function describeDataset(dataset: ClinicalDataset): string {
  switch (dataset.state) {
    case "ready":
      return dataset.sizeGb === undefined
        ? "Ready to query."
        : `Ready to query. ${formatBytes(dataset.sizeGb * 1024 ** 3)} on this computer.`;
    case "incomplete":
      return "Partly prepared. Download it or add it from a folder again to finish.";
    case "missing":
      return dataset.requiresCredentials
        ? "Not on this computer. Needs a PhysioNet account with access to it."
        : "Not on this computer.";
  }
}

/** How far a running job is: a sentence, and the share of its current phase that is done. */
export function describeJobProgress(job: ClinicalDatasetJob): {
  readonly label: string;
  readonly fraction: number | null;
} {
  const { total, completed, file } = job;
  if (total === undefined || total <= 0) return { label: job.message, fraction: null };
  const within =
    file?.totalBytes !== undefined && file.totalBytes > 0 ? file.bytes / file.totalBytes : 0;
  const fraction = Math.min(1, (completed + within) / total);
  switch (job.phase) {
    case "downloading": {
      const current =
        file === undefined
          ? ""
          : ` (${file.name}, ${formatBytes(file.bytes)}${
              file.totalBytes === undefined ? "" : ` of ${formatBytes(file.totalBytes)}`
            })`;
      return {
        label: `Downloading file ${Math.min(completed + 1, total)} of ${total}${current}`,
        fraction,
      };
    }
    case "converting":
      return { label: `Converting files for fast queries: ${completed} of ${total}`, fraction };
    case "indexing":
      return { label: `Building the database: ${completed} of ${total} tables`, fraction };
    case "starting":
      return { label: job.message, fraction: null };
  }
}
