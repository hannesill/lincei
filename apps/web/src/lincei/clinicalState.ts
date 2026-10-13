/**
 * What the clinical research tools and their datasets look like from a
 * client. Both change on the server while work runs there, and Lincei's one
 * RPC is request and response, so these hooks ask again every few seconds for
 * as long as something is in progress, and hand out `refresh` for the moments
 * that may have changed the answer.
 */
import { RegistryContext, useAtomRefresh, useAtomValue } from "@effect/atom-react";
import type { ClinicalDataset, EnvironmentId, LinceiRequest } from "@t3tools/contracts";
import { AsyncResult, Atom } from "effect/reactivity";
import { useContext, useEffect, useRef, useState } from "react";

import { toastManager } from "~/components/ui/toast";
import { useAtomCommand } from "~/state/use-atom-command";

import {
  classifyLinceiFailure,
  clinicalStatusView,
  type ClinicalStatusView,
  type DatasetAnswer,
  datasetListView,
  type DatasetListView,
  describeLinceiFailure,
  type LinceiQueryResult,
} from "./linceiAnswers";
import { linceiCommand, linceiQuery } from "./linceiRequests";

const PROGRESS_POLL_INTERVAL_MS = 2_500;
/** How long a first answer may take before the surface says so and offers to ask again. */
const SLOW_ANSWER_MS = 10_000;

const CLINICAL_STATUS = { _tag: "ClinicalStatus" } as const satisfies LinceiRequest;
const CLINICAL_DATASETS = { _tag: "ClinicalDatasets" } as const satisfies LinceiRequest;

const NOTHING_TO_ASK = Atom.make(AsyncResult.initial<never, never>(false)).pipe(
  Atom.withLabel("lincei:query:none"),
);

function usePolling(active: boolean, refresh: () => void) {
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(refresh, PROGRESS_POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [active, refresh]);
}

/** One read from a Lincei server as the cache holds it. Null without a server to ask. */
function useLinceiRead(
  environmentId: EnvironmentId | null,
  input: LinceiRequest | null,
): { readonly result: LinceiQueryResult | null; readonly refresh: () => void } {
  const atom =
    environmentId === null || input === null ? null : linceiQuery({ environmentId, input });
  const selected = atom ?? NOTHING_TO_ASK;
  const result: LinceiQueryResult = useAtomValue(selected);
  const refresh = useAtomRefresh(selected);
  // An answer stays cached for a minute after the surface that asked is gone,
  // and what it describes changes behind it (an agent may run setup or M4
  // itself), so a surface that starts reading an answer that is already there
  // asks again.
  const registry = useContext(RegistryContext);
  useEffect(() => {
    if (atom !== null && registry.get(atom)._tag !== "Initial") refresh();
  }, [atom, registry, refresh]);
  return { result: atom === null ? null : result, refresh };
}

/**
 * What is known about the clinical research tools on an environment: still
 * being asked, refused, failed, absent because the server is not Lincei, or
 * the status itself. Asks again every few seconds while setup runs.
 */
export function useClinicalStatus(environmentId: EnvironmentId | null): {
  readonly view: ClinicalStatusView;
  readonly refresh: () => void;
} {
  const { result, refresh } = useLinceiRead(environmentId, CLINICAL_STATUS);
  const view = clinicalStatusView(result);
  usePolling(view.phase === "known" && view.status.state === "installing", refresh);
  return { view, refresh };
}

/** M4's datasets on an environment. Only asked once M4 is installed there. */
export function useClinicalDatasets(
  environmentId: EnvironmentId | null,
  enabled: boolean,
): {
  readonly view: DatasetListView;
  /** The first answer is overdue: say so, since it may never come. */
  readonly takingLong: boolean;
  readonly refresh: () => void;
  /** Shows the list a dataset command answered with, ahead of the next read. */
  readonly accept: (datasets: ReadonlyArray<ClinicalDataset>) => void;
} {
  const { result, refresh } = useLinceiRead(environmentId, enabled ? CLINICAL_DATASETS : null);
  const [answer, setAnswer] = useState<DatasetAnswer | null>(null);
  const view = datasetListView(result, answer);

  // Setup downloads the demo dataset as one of these datasets' jobs. A list
  // that was on screen before setup ran would see it neither start nor end,
  // because it only asks again while it knows of a running job; it would go
  // on showing an earlier failure beside a setup that says ready. So the list
  // asks again whenever setup moves on, and keeps asking while setup is at
  // the demo dataset. Whoever shows the list keeps the status itself fresh.
  const setup = clinicalStatusView(
    useLinceiRead(environmentId, enabled ? CLINICAL_STATUS : null).result,
  );
  const setupStage =
    setup.phase === "known"
      ? `${setup.status.state}:${setup.status.step ?? ""}:${setup.status.demoDataset}`
      : setup.phase;
  const lastSetupStage = useRef(setupStage);
  useEffect(() => {
    if (lastSetupStage.current === setupStage) return;
    lastSetupStage.current = setupStage;
    refresh();
  }, [setupStage, refresh]);
  usePolling(
    (setup.phase === "known" &&
      setup.status.state === "installing" &&
      setup.status.step === "dataset") ||
      (view.phase === "listed" &&
        view.datasets.some((dataset) => dataset.job?.state === "running")),
    refresh,
  );

  const waiting = view.phase === "loading";
  const [attempt, setAttempt] = useState(0);
  const [takingLong, setTakingLong] = useState(false);
  useEffect(() => {
    if (!waiting) return;
    const timer = setTimeout(() => setTakingLong(true), SLOW_ANSWER_MS);
    return () => {
      clearTimeout(timer);
      setTakingLong(false);
    };
  }, [waiting, attempt]);

  return {
    view,
    takingLong,
    refresh: () => {
      setAttempt((count) => count + 1);
      refresh();
    },
    accept: (datasets) => setAnswer({ datasets, at: Date.now() }),
  };
}

/** Starts, or repeats, clinical setup on an environment and says so when it could not. */
export function useClinicalSetup(environmentId: EnvironmentId | null, refresh: () => void) {
  const request = useAtomCommand(linceiCommand, { reportFailure: false });
  return async () => {
    if (environmentId === null) return;
    const started = await request({ environmentId, input: { _tag: "ClinicalSetup" } });
    if (started._tag === "Failure") {
      const description = describeLinceiFailure(classifyLinceiFailure(started.cause));
      if (description !== null) {
        toastManager.add({ type: "error", title: "Could not start clinical setup", description });
      }
    }
    refresh();
  };
}
