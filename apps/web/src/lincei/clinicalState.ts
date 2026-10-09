/**
 * What the clinical environment and its datasets look like from a client.
 * Both change on the server while work runs there, and Lincei's one RPC is
 * request and response, so these hooks ask again every few seconds for as
 * long as something is in progress and not at all otherwise.
 */
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { ClinicalDataset, ClinicalRuntimeStatus, EnvironmentId } from "@t3tools/contracts";
import { useEffect, useRef } from "react";

import { toastManager } from "~/components/ui/toast";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";

import { linceiCommand, linceiQuery } from "./linceiRequests";

const PROGRESS_POLL_INTERVAL_MS = 2_500;

function usePolling(active: boolean, refresh: () => void) {
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(refresh, PROGRESS_POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [active, refresh]);
}

/** The clinical environment's setup state, or null against a server that is not Lincei. */
export function useClinicalStatus(environmentId: EnvironmentId | null): {
  readonly status: ClinicalRuntimeStatus | null;
  readonly refresh: () => void;
} {
  const query = useEnvironmentQuery(
    environmentId === null
      ? null
      : linceiQuery({ environmentId, input: { _tag: "ClinicalStatus" } }),
  );
  const status = query.data?._tag === "Clinical" ? query.data.status : null;
  usePolling(status?.state === "installing", query.refresh);
  return { status, refresh: query.refresh };
}

/** Whether M4 and Vitrine can be used: the demo dataset downloads after they are installed. */
export function clinicalToolsInstalled(status: ClinicalRuntimeStatus | null): boolean {
  return (
    status !== null &&
    (status.state === "ready" || (status.state === "installing" && status.step === "dataset"))
  );
}

/** M4's datasets, once M4 is installed. */
export function useClinicalDatasets(
  environmentId: EnvironmentId | null,
  enabled: boolean,
): {
  readonly datasets: ReadonlyArray<ClinicalDataset> | null;
  readonly error: string | null;
  readonly refresh: () => void;
} {
  const query = useEnvironmentQuery(
    environmentId === null || !enabled
      ? null
      : linceiQuery({ environmentId, input: { _tag: "ClinicalDatasets" } }),
  );
  const datasets = query.data?._tag === "ClinicalDatasets" ? query.data.datasets : null;
  // The answer is cached for a minute after the page that asked is gone, and
  // datasets change behind it (an agent may run M4 itself), so a page that
  // opens onto a cached answer asks again.
  const openedOnCachedAnswer = useRef(datasets !== null);
  const { refresh } = query;
  useEffect(() => {
    if (openedOnCachedAnswer.current) refresh();
  }, [refresh]);
  usePolling(datasets?.some((dataset) => dataset.job?.state === "running") === true, query.refresh);
  return { datasets, error: query.error, refresh: query.refresh };
}

export function describeCommandFailure(
  result: Parameters<typeof squashAtomCommandFailure>[0],
): string {
  const error = squashAtomCommandFailure(result);
  return error instanceof Error ? error.message : String(error);
}

/** Starts, or repeats, clinical setup on an environment and says so when it could not. */
export function useClinicalSetup(environmentId: EnvironmentId | null, refresh: () => void) {
  const request = useAtomCommand(linceiCommand, { reportFailure: false });
  return async () => {
    if (environmentId === null) return;
    const started = await request({ environmentId, input: { _tag: "ClinicalSetup" } });
    if (started._tag === "Failure" && !isAtomCommandInterrupted(started)) {
      toastManager.add({
        type: "error",
        title: "Could not start clinical setup",
        description: describeCommandFailure(started),
      });
    }
    refresh();
  };
}
