import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  AuthOrchestrationOperateScope,
  type ClinicalRuntimeStatus,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { FlaskConicalIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { resolveDiscoveredServerUrl } from "~/browser/browserTargetResolver";
import { type OpenPreviewMutation, openUrlInPreview } from "~/browser/openFileInPreview";
import { isPreviewAvailableFor, previewRuntimeFor } from "~/browser/previewRuntime";
import { Button } from "~/components/ui/button";
import { toastManager } from "~/components/ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { useEnvironmentQuery } from "~/state/query";
import { useEnvironmentScope } from "~/state/session";
import { useAtomCommand } from "~/state/use-atom-command";

import { linceiCommand, linceiQuery } from "./linceiRequests";

const SETUP_POLL_INTERVAL_MS = 2_500;

export interface ResearchBoardTarget {
  readonly threadRef: ScopedThreadRef | null;
  /** The folder the thread works in, where its study lives. */
  readonly cwd: string | null;
  readonly openPreview: OpenPreviewMutation;
}

type Marker = "none" | "working" | "failed";

function describe(
  status: ClinicalRuntimeStatus,
  hasFolder: boolean,
): { label: string; marker: Marker } {
  switch (status.state) {
    case "installing":
      // Vitrine is installed before the demo dataset, so the board already opens.
      return {
        label:
          status.step === "dataset" && hasFolder
            ? `Open research board. ${status.message}`
            : `Setting up the clinical environment. ${status.message}`,
        marker: "working",
      };
    case "failed":
      return {
        label: `Clinical setup failed. ${status.message} Click to try again.`,
        marker: "failed",
      };
    case "not-installed":
      return { label: "Set up the clinical environment", marker: "none" };
    case "ready":
      return {
        label: hasFolder ? "Open research board" : "Open a project to see its research board",
        marker: "none",
      };
  }
}

function describeFailure(result: Parameters<typeof squashAtomCommandFailure>[0]): string {
  const error = squashAtomCommandFailure(result);
  return error instanceof Error ? error.message : String(error);
}

/**
 * Opens the thread's Vitrine study in the right panel, and shows how the
 * clinical environment's setup is going until there is a study to open.
 * Renders nothing against a server that is not Lincei.
 */
export function ResearchBoardButton({ threadRef, cwd, openPreview }: ResearchBoardTarget) {
  const environmentId = threadRef?.environmentId ?? null;
  const canOperate = useEnvironmentScope(environmentId, AuthOrchestrationOperateScope);
  const statusQuery = useEnvironmentQuery(
    environmentId === null
      ? null
      : linceiQuery({ environmentId, input: { _tag: "ClinicalStatus" } }),
  );
  const request = useAtomCommand(linceiCommand, { reportFailure: false });
  const [busy, setBusy] = useState(false);

  const status = statusQuery.data?._tag === "Clinical" ? statusQuery.data.status : null;
  const installing = status?.state === "installing";
  const refreshStatus = statusQuery.refresh;
  useEffect(() => {
    if (!installing) return;
    const timer = setInterval(refreshStatus, SETUP_POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [installing, refreshStatus]);

  if (threadRef === null || status === null) return null;

  const { label, marker } = describe(status, cwd !== null);
  const needsSetup = status.state === "not-installed" || status.state === "failed";
  const needsFolder = !needsSetup && cwd === null;

  const reportFailure = (title: string, description: string) =>
    toastManager.add({ type: "error", title, description });

  const activate = async () => {
    setBusy(true);
    try {
      if (needsSetup) {
        const started = await request({
          environmentId: threadRef.environmentId,
          input: { _tag: "ClinicalSetup" },
        });
        if (started._tag === "Failure" && !isAtomCommandInterrupted(started)) {
          reportFailure("Could not start clinical setup", describeFailure(started));
        }
        refreshStatus();
        return;
      }
      if (cwd === null) return;
      if (!isPreviewAvailableFor(threadRef.environmentId)) {
        reportFailure(
          "Could not open the research board",
          "The built-in browser is not available for this environment.",
        );
        return;
      }

      const opened = await request({
        environmentId: threadRef.environmentId,
        input: { _tag: "ResearchBoardOpen", cwd },
      });
      if (opened._tag === "Failure") {
        if (!isAtomCommandInterrupted(opened)) {
          reportFailure("Could not open the research board", describeFailure(opened));
        }
        return;
      }
      if (opened.value._tag !== "ResearchBoard") {
        // Vitrine is not installed yet; the server answered with how far setup is.
        refreshStatus();
        toastManager.add({
          type: "info",
          title: "The clinical environment is still being set up",
          description: opened.value.status.message,
        });
        return;
      }

      const { board } = opened.value;
      // A browser tab that runs on the server reaches Vitrine's own address. A
      // tab on this machine needs a loopback URL the resolver can route.
      const url =
        previewRuntimeFor(threadRef.environmentId) === "server"
          ? board.url
          : resolveDiscoveredServerUrl(threadRef.environmentId, `http://127.0.0.1:${board.port}/`);
      const shown = await openUrlInPreview({ threadRef, url, openPreview });
      if (shown._tag === "Failure" && !isAtomCommandInterrupted(shown)) {
        reportFailure("Could not open the research board", describeFailure(shown));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Tooltip>
      <TooltipTrigger
        render={<span className="relative mr-1 flex shrink-0 [-webkit-app-region:no-drag]" />}
      >
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          disabled={busy || !canOperate || needsFolder}
          onClick={() => void activate()}
        >
          <FlaskConicalIcon />
        </Button>
        {marker === "none" ? null : (
          <span
            aria-hidden
            className={
              marker === "failed"
                ? "pointer-events-none absolute top-1 right-1 size-1.5 rounded-full bg-destructive"
                : "pointer-events-none absolute top-1 right-1 size-1.5 rounded-full bg-amber-500"
            }
          />
        )}
      </TooltipTrigger>
      <TooltipPopup side="bottom">{label}</TooltipPopup>
    </Tooltip>
  );
}
