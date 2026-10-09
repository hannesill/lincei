/**
 * What the clinical environment and its datasets look like from a client.
 * Both change on the server while work runs there, and Lincei's one RPC is
 * request and response, so these hooks ask again every few seconds for as
 * long as something is in progress and not at all otherwise.
 */
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { ClinicalDataset, ClinicalRuntimeStatus, EnvironmentId } from "@t3tools/contracts";
import { useEffect } from "react";

import { useEnvironmentQuery } from "~/state/query";

import { linceiQuery } from "./linceiRequests";

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
  usePolling(datasets?.some((dataset) => dataset.job?.state === "running") === true, query.refresh);
  return { datasets, error: query.error, refresh: query.refresh };
}

export function describeCommandFailure(
  result: Parameters<typeof squashAtomCommandFailure>[0],
): string {
  const error = squashAtomCommandFailure(result);
  return error instanceof Error ? error.message : String(error);
}
