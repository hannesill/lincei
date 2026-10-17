/**
 * How the clinical research tools' setup and the datasets' jobs read to a
 * person: which setup steps are behind us, how far a job is, what to call a
 * dataset and the state it is in, and what to say when something is missing.
 */
import type {
  ClinicalDataset,
  ClinicalDatasetJob,
  ClinicalProvisionStep,
  ClinicalRuntimeStatus,
} from "@t3tools/contracts";
import { isLocalLoopbackHost } from "@t3tools/shared/hostClassification";
import { isLoopbackHost } from "@t3tools/shared/preview";

import type { ClinicalStatusView } from "./linceiAnswers";

/**
 * The first-run wizard's stages, of which the last is Lincei's own step.
 * `scripts/lincei/identity.ts` writes the same list into the header of
 * upstream's wizard, which shows the first three. The two have to read the
 * same, or the header changes its words on the way to the last step.
 */
export const WIZARD_STAGES = ["Computer", "Agent", "Import", "Data"] as const;

export type ClinicalStepState = "done" | "active" | "failed" | "pending";

/** Setup's steps in the order they run. */
export const CLINICAL_SETUP_STEPS: ReadonlyArray<{
  readonly step: ClinicalProvisionStep;
  readonly label: string;
}> = [
  { step: "uv", label: "Python installer" },
  { step: "python", label: "Python" },
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
      // The tools work. What can have failed is the demo download, which they
      // do not need, or a later update, whose step the status then names.
      const failed =
        step === status.step || (step === "dataset" && status.demoDataset === "failed");
      return { step, state: failed ? "failed" : "done" };
    }
    if (status.state === "not-installed" || current === -1) return { step, state: "pending" };
    if (index < current) return { step, state: "done" };
    if (index > current) return { step, state: "pending" };
    return { step, state: status.state === "failed" ? "failed" : "active" };
  });
}

/** Whether M4 and Vitrine can be used: the demo dataset downloads after they are installed. */
export function clinicalToolsInstalled(status: ClinicalRuntimeStatus): boolean {
  return status.state === "ready" || (status.state === "installing" && status.step === "dataset");
}

/**
 * Whether setup has more to show than "ready": steps under way, or something
 * that did not finish. Tools that work can still be here, after a demo
 * download or an update of them failed.
 */
export function clinicalSetupUnsettled(status: ClinicalRuntimeStatus): boolean {
  return (
    status.state !== "ready" ||
    status.demoDataset === "failed" ||
    status.step !== undefined ||
    status.detail !== undefined
  );
}

/** The button that starts, repeats, or completes setup. Null when setup needs nothing from the user. */
export function clinicalSetupAction(
  status: ClinicalRuntimeStatus,
): "Set up" | "Try again" | "Retry the demo download" | null {
  switch (status.state) {
    case "not-installed":
      return "Set up";
    case "failed":
      return "Try again";
    case "ready":
      if (status.demoDataset === "failed") return "Retry the demo download";
      return clinicalSetupUnsettled(status) ? "Try again" : null;
    case "installing":
      return null;
  }
}

const SETTINGS_PAGE = "Settings, Clinical Data";

/**
 * The sentence beside the wizard's Continue button. It says what leaving the
 * step means in the state the step is in, so it never promises that something
 * keeps running when nothing was started.
 */
export function clinicalStepFooter(view: ClinicalStatusView): string {
  if (view.phase !== "known") {
    return `You can continue and come back to this under ${SETTINGS_PAGE}.`;
  }
  const { status } = view;
  switch (status.state) {
    case "not-installed":
      return `Setup has not started. Start it here, or later under ${SETTINGS_PAGE}.`;
    case "installing":
      return `Setup keeps running after you continue. Find it again under ${SETTINGS_PAGE}.`;
    case "failed":
      return `Setup stopped. Try again here, or later under ${SETTINGS_PAGE}.`;
    case "ready":
      if (status.demoDataset === "failed") {
        return `The demo dataset is missing. Retry here, or later under ${SETTINGS_PAGE}.`;
      }
      return clinicalSetupUnsettled(status)
        ? `The tools work, but an update of them stopped. Try again here, or later under ${SETTINGS_PAGE}.`
        : `Downloads keep running after you continue. Find them again under ${SETTINGS_PAGE}.`;
  }
}

type DatasetNaming = Pick<ClinicalDataset, "name" | "title">;

/** What to call a dataset: M4's title for it, or M4's id, which agents use, where it has none. */
export function datasetDisplayName(dataset: DatasetNaming): string {
  return dataset.title ?? dataset.name;
}

/**
 * A sentence the server wrote about one dataset, with the dataset's id
 * replaced by its name. The server names datasets the way M4 does.
 */
export function withDatasetName(text: string, dataset: DatasetNaming): string {
  const name = datasetDisplayName(dataset);
  if (name === dataset.name) return text;
  const escaped = dataset.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Not inside a longer id or a path: `mimic-iv` must not match in `mimic-iv-note`.
  return text.replace(new RegExp(`(?<![\\w/-])${escaped}(?![\\w/-])`, "g"), name);
}

/**
 * The id agents will use for a dataset someone names `title`: lower case,
 * with dashes between words, as M4 takes ids. Empty when the title has no
 * letters or digits M4 accepts.
 */
export function datasetIdFromTitle(title: string): string {
  return title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
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

/**
 * What a dataset's row says when no job is running on it. `place` is where
 * the dataset is kept, as the reader would say it: "this computer", or the
 * name of another one.
 */
export function describeDataset(dataset: ClinicalDataset, place = "this computer"): string {
  switch (dataset.state) {
    case "ready":
      return dataset.sizeGb === undefined
        ? "Ready to query."
        : `Ready to query. ${formatBytes(dataset.sizeGb * 1024 ** 3)} on ${place}.`;
    case "incomplete":
      return "Partly prepared. Finish adding it to make it ready.";
    case "missing":
      return `Not on ${place}.`;
  }
}

/**
 * Which list a dataset belongs in: what a computer has or is getting, or
 * what can still be added to it. A download that failed before anything
 * arrived stays with what can be added, where it is tried again.
 */
export function datasetGroup(dataset: ClinicalDataset): "present" | "available" {
  return dataset.state !== "missing" || dataset.job?.state === "running" ? "present" : "available";
}

/**
 * What the question before removing a dataset says: what is deleted, and that
 * the folder a dataset of the user's own came from is not.
 */
export function describeRemoval(
  dataset: ClinicalDataset,
  place = "this computer",
): { readonly title: string; readonly description: string } {
  const name = datasetDisplayName(dataset);
  const size = dataset.sizeGb === undefined ? "" : ` (${formatBytes(dataset.sizeGb * 1024 ** 3)})`;
  return {
    title: `Remove ${name}?`,
    description:
      dataset.custom === true
        ? `Lincei deletes what it prepared of ${name}${size} on ${place} and forgets the dataset. The folder you added it from stays as it is. Agents can no longer query it; to use it again, add the folder again.`
        : `Lincei deletes the files of ${name}${size} from ${place}. Agents can no longer query it until you add it again.`,
  };
}

/** What helps decide whether to add a dataset, beyond what it is: short enough for one line. */
export function datasetFacts(dataset: ClinicalDataset): ReadonlyArray<string> {
  return [
    ...(dataset.downloadSizeGb === undefined
      ? []
      : [`About ${formatBytes(dataset.downloadSizeGb * 1024 ** 3)} to download`]),
    ...(dataset.version === undefined ? [] : [`Version ${dataset.version}`]),
  ];
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

/**
 * What is wrong with a folder path before the server is asked, or null. The
 * server takes the path as typed: it does not know the reader's home folder,
 * so `~` and a path relative to nothing both read to it as "does not exist".
 */
export function folderPathProblem(path: string): string | null {
  const isFullPath = /^(?:\/|[A-Za-z]:[\\/]|\\\\)/.test(path);
  if (isFullPath) return null;
  return path.startsWith("~")
    ? "Type the full path instead of ~, for example /Users/you/Downloads/mimic-iv."
    : "Type the folder's full path, for example /Users/you/Downloads/mimic-iv.";
}

/**
 * What to tell someone whose Lincei cannot reach the server that holds the
 * clinical research tools. `otherComputer` is that computer's name, or null
 * when it is the one Lincei itself runs on, where the server is a background
 * service the reader has never seen.
 */
export function describeLostConnection(input: {
  readonly otherComputer: string | null;
  /** Whether Lincei is still trying by itself. */
  readonly reconnecting: boolean;
}): { readonly title: string; readonly detail: string } {
  const { otherComputer, reconnecting } = input;
  if (otherComputer === null) {
    return {
      title: "Lincei lost the connection to its background service",
      detail: reconnecting
        ? "The service runs on this computer and looks after the clinical research tools. Lincei is reconnecting, and this page comes back by itself. If it stays like this for more than a minute, quit Lincei and open it again."
        : "The service runs on this computer and looks after the clinical research tools. Lincei has stopped trying to reconnect. Reconnect below, or quit Lincei and open it again.",
    };
  }
  return {
    title: `Lincei lost the connection to ${otherComputer}`,
    detail: reconnecting
      ? `Lincei is reconnecting, and this page comes back by itself. If it stays like this, check that ${otherComputer} is on and that Lincei is running there.`
      : `Check that ${otherComputer} is on and that Lincei is running there, then reconnect below.`,
  };
}

/**
 * Whether the server at `httpBaseUrl` runs on the computer in front of the
 * reader, so a folder it opens opens on this screen: the case when this window
 * reaches it at a loopback address. Which environment is the primary one does
 * not say: a browser reaches a primary server elsewhere over the network.
 */
export function serverOnThisComputer(httpBaseUrl: string | null): boolean {
  if (httpBaseUrl === null || !URL.canParse(httpBaseUrl)) return false;
  const { hostname } = new URL(httpBaseUrl);
  // Browsers resolve every `*.localhost` name to the loopback address.
  return isLocalLoopbackHost(hostname) || hostname.endsWith(".localhost");
}

/**
 * Whether a password may travel to the environment at `httpBaseUrl`: only to
 * this machine or over TLS. A server reached over plain HTTP on a network is
 * a place where anyone on that network can read what is sent.
 */
export function connectionProtectsSecrets(httpBaseUrl: string | null): boolean {
  if (httpBaseUrl === null) return false;
  try {
    const url = new URL(httpBaseUrl);
    return url.protocol === "https:" || isLoopbackHost(url.hostname);
  } catch {
    return false;
  }
}
