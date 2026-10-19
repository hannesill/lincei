/**
 * What a thread shows of its agents' image requests (ClinicalImageRequests on
 * the server): whether to ask the researcher to sign in, what the header's
 * button says, and which outcomes to announce.
 */
import type { ClinicalImageRequest } from "@t3tools/contracts";

import { datasetDisplayName } from "./clinicalPresentation";

/** A request someone still has to act on, or one that is running. */
export const isOpenRequest = (request: ClinicalImageRequest): boolean =>
  request.state === "waiting-for-login" || request.state === "fetching";

export const requestDatasetName = (request: ClinicalImageRequest): string =>
  datasetDisplayName({
    name: request.dataset,
    ...(request.datasetTitle === undefined ? {} : { title: request.datasetTitle }),
  });

export interface ImageRequestButton {
  /** The request the button opens, the one that most needs the researcher. */
  readonly request: ClinicalImageRequest;
  readonly label: string;
  /** A dot on the button while the researcher is waited for. */
  readonly waiting: boolean;
}

/**
 * The header's button while a request needs the researcher or runs: one
 * waiting for a login comes first, then one fetching, then one whose fetch
 * failed, which can be signed in to again. Nothing once every request is done
 * or declined; those were announced as they ended.
 */
export function describeImageRequestButton(
  requests: ReadonlyArray<ClinicalImageRequest>,
): ImageRequestButton | null {
  const waiting = requests.find((request) => request.state === "waiting-for-login");
  if (waiting !== undefined) {
    return {
      request: waiting,
      label: `Sign in with PhysioNet to fetch ${waiting.images} images from ${requestDatasetName(waiting)}`,
      waiting: true,
    };
  }
  const fetching = requests.find((request) => request.state === "fetching");
  if (fetching !== undefined) {
    const total = fetching.total ?? fetching.images;
    return {
      request: fetching,
      label: `Fetching images from ${requestDatasetName(fetching)}: ${fetching.completed} of ${total}`,
      waiting: false,
    };
  }
  const failed = requests.findLast((request) => request.state === "failed");
  if (failed === undefined) return null;
  return {
    request: failed,
    label: `Fetching images from ${requestDatasetName(failed)} stopped. Sign in again to retry`,
    waiting: true,
  };
}

/**
 * What changed since the last look that this window should act on: requests
 * that newly wait for a login (to open the sign-in dialog for, once), and
 * requests seen open that have now finished (to announce, once).
 */
export function imageRequestNews(
  previous: ReadonlyArray<ClinicalImageRequest>,
  current: ReadonlyArray<ClinicalImageRequest>,
): {
  readonly newlyWaiting: ReadonlyArray<ClinicalImageRequest>;
  readonly finished: ReadonlyArray<ClinicalImageRequest>;
} {
  const before = new Map(previous.map((request) => [request.id, request]));
  return {
    newlyWaiting: current.filter(
      (request) =>
        request.state === "waiting-for-login" &&
        before.get(request.id)?.state !== "waiting-for-login",
    ),
    finished: current.filter((request) => {
      const earlier = before.get(request.id);
      return earlier !== undefined && isOpenRequest(earlier) && !isOpenRequest(request);
    }),
  };
}
