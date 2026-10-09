import { isAtomCommandInterrupted } from "@t3tools/client-runtime/state/runtime";
import {
  AuthOrchestrationOperateScope,
  type ClinicalRuntimeStatus,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { FlaskConicalIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { resolveDiscoveredServerUrl } from "~/browser/browserTargetResolver";
import { type OpenPreviewMutation, openUrlInPreview } from "~/browser/openFileInPreview";
import { isPreviewAvailableFor, previewRuntimeFor } from "~/browser/previewRuntime";
import { Button } from "~/components/ui/button";
import { toastManager } from "~/components/ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import type { SessionPhase } from "~/types";
import { useEnvironmentScope } from "~/state/session";
import { useAtomCommand } from "~/state/use-atom-command";

import { clinicalToolsInstalled, describeCommandFailure, useClinicalStatus } from "./clinicalState";
import { linceiCommand } from "./linceiRequests";

const ACTIVITY_POLL_INTERVAL_MS = 4_000;

/**
 * Threads whose board has been opened in this window, by the user or for
 * them. The board opens by itself once per thread; after that its place in
 * the panel is the user's to decide.
 */
const openedThreads = new Set<string>();

export interface ResearchBoardTarget {
  readonly threadRef: ScopedThreadRef | null;
  /** The folder the thread works in, where its study lives. */
  readonly cwd: string | null | undefined;
  readonly openPreview: OpenPreviewMutation;
  /** Whether an agent is working in the thread, which is when cards appear. */
  readonly phase: SessionPhase;
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

/**
 * Opens the thread's Vitrine study in the right panel, and shows how the
 * clinical environment's setup is going until there is a study to open. The
 * first time an agent publishes a card while the thread is on screen, the
 * board opens by itself. Renders nothing against a server that is not Lincei.
 */
export function ResearchBoardButton({ threadRef, cwd, openPreview, phase }: ResearchBoardTarget) {
  const environmentId = threadRef?.environmentId ?? null;
  const threadId = threadRef?.threadId ?? null;
  const folder = cwd ?? null;
  const canOperate = useEnvironmentScope(environmentId, AuthOrchestrationOperateScope);
  const { status, refresh: refreshStatus } = useClinicalStatus(environmentId);
  const request = useAtomCommand(linceiCommand, { reportFailure: false });
  const [busy, setBusy] = useState(false);

  /** Shows the board in the panel. `quiet` when nobody asked: a failure then is not news. */
  const openBoard = async (quiet: boolean) => {
    if (threadRef === null || folder === null) return;
    const reportFailure = (description: string) =>
      quiet
        ? undefined
        : toastManager.add({
            type: "error",
            title: "Could not open the research board",
            description,
          });
    if (!isPreviewAvailableFor(threadRef.environmentId)) {
      reportFailure("The built-in browser is not available for this environment.");
      return;
    }
    openedThreads.add(`${threadRef.environmentId}:${threadRef.threadId}`);
    const opened = await request({
      environmentId: threadRef.environmentId,
      input: { _tag: "ResearchBoardOpen", cwd: folder },
    });
    if (opened._tag === "Failure") {
      if (!isAtomCommandInterrupted(opened)) reportFailure(describeCommandFailure(opened));
      return;
    }
    if (opened.value._tag !== "ResearchBoard") {
      // Vitrine is not installed yet; the server answered with how far setup is.
      refreshStatus();
      if (!quiet && opened.value._tag === "Clinical") {
        toastManager.add({
          type: "info",
          title: "The clinical environment is still being set up",
          description: opened.value.status.message,
        });
      }
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
      reportFailure(describeCommandFailure(shown));
    }
  };
  // The watcher below outlives the render that started it.
  const openBoardRef = useRef(openBoard);
  openBoardRef.current = openBoard;

  // While an agent works, watch the study for its next card and open the
  // board when it arrives. The first answer is the baseline: cards that were
  // already there are not news.
  const watching =
    phase === "running" &&
    canOperate &&
    environmentId !== null &&
    threadId !== null &&
    folder !== null &&
    clinicalToolsInstalled(status);
  useEffect(() => {
    if (!watching || environmentId === null) return;
    const threadKey = `${environmentId}:${threadId}`;
    if (openedThreads.has(threadKey)) return;
    let baseline: number | null | undefined;
    let stopped = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    const stop = () => {
      stopped = true;
      clearInterval(timer);
    };
    const check = async () => {
      const result = await request({
        environmentId,
        input: { _tag: "ResearchBoardActivity", cwd: folder },
      });
      if (stopped || result._tag === "Failure") return;
      if (result.value._tag !== "ResearchBoardActivity") return;
      const updatedAt = result.value.updatedAt ?? null;
      if (baseline === undefined) {
        baseline = updatedAt;
        return;
      }
      if (updatedAt === null || (baseline !== null && updatedAt <= baseline)) return;
      stop();
      if (!openedThreads.has(threadKey)) void openBoardRef.current(true);
    };
    timer = setInterval(() => void check(), ACTIVITY_POLL_INTERVAL_MS);
    void check();
    return stop;
  }, [watching, environmentId, threadId, folder, request]);

  if (threadRef === null || status === null) return null;

  const { label, marker } = describe(status, folder !== null);
  const needsSetup = status.state === "not-installed" || status.state === "failed";
  const needsFolder = !needsSetup && folder === null;

  const activate = async () => {
    setBusy(true);
    try {
      if (needsSetup) {
        const started = await request({
          environmentId: threadRef.environmentId,
          input: { _tag: "ClinicalSetup" },
        });
        if (started._tag === "Failure" && !isAtomCommandInterrupted(started)) {
          toastManager.add({
            type: "error",
            title: "Could not start clinical setup",
            description: describeCommandFailure(started),
          });
        }
        refreshStatus();
        return;
      }
      await openBoard(false);
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
