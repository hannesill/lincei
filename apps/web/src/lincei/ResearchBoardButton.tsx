import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { AuthOrchestrationOperateScope, type ScopedThreadRef } from "@t3tools/contracts";
import { FlaskConicalIcon } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import type { OpenPreviewMutation } from "~/browser/openFileInPreview";
import { usePreviewAvailable } from "~/browser/previewRuntime";
import { Button } from "~/components/ui/button";
import { toastManager } from "~/components/ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { useEnvironmentScope } from "~/state/session";
import { useAtomCommand } from "~/state/use-atom-command";
import type { SessionPhase } from "~/types";

import { clinicalToolsInstalled } from "./clinicalPresentation";
import { useClinicalSetup, useClinicalStatus } from "./clinicalState";
import { linceiCommand } from "./linceiRequests";
import { openResearchBoard } from "./openResearchBoard";
import {
  createResearchBoardWatcher,
  createWatcherKeeper,
  describeBoardButton,
  type ResearchBoardWatcher,
} from "./researchBoardLogic";

const ACTIVITY_POLL_INTERVAL_MS = 4_000;

/**
 * Threads whose board has been shown in this window, by the user or for them.
 * The board opens by itself once per thread; after that its place in the
 * panel is the user's to decide. A thread is only added once its board is on
 * screen, so a click or a card that could not open it leaves the next one free
 * to.
 */
const shownThreads = new Set<string>();
const shownListeners = new Set<() => void>();

function markBoardShown(threadKey: string) {
  if (shownThreads.has(threadKey)) return;
  shownThreads.add(threadKey);
  for (const listener of shownListeners) listener();
}

function subscribeToShownThreads(listener: () => void) {
  shownListeners.add(listener);
  return () => {
    shownListeners.delete(listener);
  };
}

function useBoardShown(threadKey: string | null): boolean {
  return useSyncExternalStore(
    subscribeToShownThreads,
    () => threadKey !== null && shownThreads.has(threadKey),
  );
}

/**
 * The watchers of the threads on screen, by thread and folder. Upstream draws
 * the panel controls at a different place in the tree while the right panel is
 * open, which unmounts this button and mounts it again; the keeper hands the
 * thread's watcher from the one mount to the next.
 */
const watchers = createWatcherKeeper();

export interface ResearchBoardTarget {
  readonly threadRef: ScopedThreadRef | null;
  /** The folder the thread works in, where its study lives. */
  readonly cwd: string | null | undefined;
  readonly openPreview: OpenPreviewMutation;
  /** Whether an agent is working in the thread, which is when cards appear. */
  readonly phase: SessionPhase;
}

/**
 * Shows the thread's Vitrine study in the right panel, and how the clinical
 * research tools' setup is going until there is a study to show. A click
 * brings back the board's tab when the thread already has one. The first time
 * an agent publishes a card while the thread is on screen, the board opens by
 * itself. Renders nothing against a server that is not Lincei.
 */
export function ResearchBoardButton({ threadRef, cwd, openPreview, phase }: ResearchBoardTarget) {
  const environmentId = threadRef?.environmentId ?? null;
  const threadId = threadRef?.threadId ?? null;
  const folder = cwd ?? null;
  const canOperate = useEnvironmentScope(environmentId, AuthOrchestrationOperateScope);
  // The board is a page in upstream's browser, which a plain browser window
  // only has when the server can run one.
  const canShowBoard = usePreviewAvailable(environmentId);
  const { view, refresh: refreshStatus } = useClinicalStatus(environmentId);
  const request = useAtomCommand(linceiCommand, { reportFailure: false });
  const setUp = useClinicalSetup(environmentId, refreshStatus);
  const [busy, setBusy] = useState(false);
  const shown = useBoardShown(threadRef === null ? null : scopedThreadKey(threadRef));
  const running = phase === "running";

  // An agent can run or repair setup, and nothing else tells this window, so
  // the status is read again when a turn starts and when it ends.
  const wasRunning = useRef(running);
  useEffect(() => {
    if (wasRunning.current === running) return;
    wasRunning.current = running;
    refreshStatus();
  }, [running, refreshStatus]);

  // While an agent works, watch the study for its next card and show the
  // board when it arrives. The watcher lives as long as this thread is on
  // screen and could still be surprised by a card; the second effect tells it
  // when a turn starts and ends.
  const watchable =
    canOperate &&
    canShowBoard &&
    !shown &&
    environmentId !== null &&
    threadId !== null &&
    folder !== null &&
    view.phase === "known" &&
    clinicalToolsInstalled(view.status);
  const watcher = useRef<ResearchBoardWatcher | null>(null);
  useEffect(() => {
    if (!watchable || environmentId === null || threadId === null || folder === null) return;
    const watched = scopeThreadRef(environmentId, threadId);
    const held = watchers.hold(`${scopedThreadKey(watched)}\n${folder}`, () =>
      createResearchBoardWatcher({
        intervalMs: ACTIVITY_POLL_INTERVAL_MS,
        readActivity: async () => {
          const answer = await request({
            environmentId,
            input: { _tag: "ResearchBoardActivity", cwd: folder },
          });
          return answer._tag === "Success" && answer.value._tag === "ResearchBoardActivity"
            ? (answer.value.updatedAt ?? null)
            : undefined;
        },
        // Nobody asked for the board, so failing to show it is not worth a
        // message. The thread stays unmarked and the next card tries again.
        onNews: () =>
          void openResearchBoard({ threadRef: watched, cwd: folder, request, openPreview }).then(
            (opening) => {
              if (opening._tag === "Shown") markBoardShown(scopedThreadKey(watched));
            },
          ),
      }),
    );
    watcher.current = held.watcher;
    return () => {
      watcher.current = null;
      held.release();
    };
  }, [watchable, environmentId, threadId, folder, request, openPreview]);
  useEffect(() => {
    if (running) watcher.current?.start();
    else watcher.current?.finish();
    // The same list as above, so a watcher made mid-turn is started too.
  }, [running, watchable, environmentId, threadId, folder, request, openPreview]);

  const button = describeBoardButton({
    view,
    hasFolder: folder !== null,
    canShowBoard,
    canOperate,
  });
  if (threadRef === null || button === null) return null;
  const inactive = busy || !button.enabled;

  /** What a click does once the status is known: show the board, or start what it waits for. */
  const showOrSetUp = async () => {
    // Without a folder or a browser there is no board to ask for, and the
    // button is only enabled for what is left: starting setup.
    if (folder === null || !canShowBoard) {
      await setUp();
      return;
    }
    // The server answers from the tools' state now, not the one on screen.
    const opening = await openResearchBoard({ threadRef, cwd: folder, request, openPreview });
    switch (opening._tag) {
      case "Shown":
        markBoardShown(scopedThreadKey(threadRef));
        return;
      case "SettingUp":
        if (opening.status.state === "installing") {
          toastManager.add({
            type: "info",
            title: "The clinical research tools are still being set up",
            description: opening.status.message,
          });
          return;
        }
        await setUp();
        return;
      case "Unavailable":
        if (opening.message !== null) {
          toastManager.add({
            type: "error",
            title: "Could not open the research board",
            description: opening.message,
          });
        }
    }
  };

  const activate = () => {
    if (inactive) return;
    // The click is a reason to look again: what the button shows may be old.
    refreshStatus();
    if (view.phase !== "known") return;
    setBusy(true);
    // Not try/finally: the React Compiler leaves a component with one uncompiled.
    void showOrSetUp().finally(() => setBusy(false));
  };

  return (
    <Tooltip>
      <TooltipTrigger
        render={<span className="relative mr-1 flex shrink-0 [-webkit-app-region:no-drag]" />}
      >
        {/* Not `disabled`: the button stays reachable by keyboard so its label can say why. */}
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={button.label}
          aria-disabled={inactive}
          onClick={activate}
        >
          <FlaskConicalIcon />
        </Button>
        {button.marker === "none" ? null : (
          <span
            aria-hidden
            className={
              button.marker === "failed"
                ? "pointer-events-none absolute top-1 right-1 size-1.5 rounded-full bg-destructive"
                : "pointer-events-none absolute top-1 right-1 size-1.5 rounded-full bg-warning"
            }
          />
        )}
      </TooltipTrigger>
      <TooltipPopup side="bottom">{button.label}</TooltipPopup>
    </Tooltip>
  );
}
