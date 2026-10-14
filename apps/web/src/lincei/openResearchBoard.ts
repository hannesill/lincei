/**
 * Shows a thread's research board in the right panel: the browser tab that is
 * already on it when the thread has one, a new tab otherwise.
 *
 * Tabs are upstream's: the server keeps one preview session per tab, the
 * client mirrors them in `previewStateStore`, and `rightPanelStore` decides
 * which one the panel shows. This asks the Lincei server where the board is,
 * looks for it among the thread's sessions, and uses upstream's own calls to
 * select or open it.
 */
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { isAtomCommandInterrupted } from "@t3tools/client-runtime/state/runtime";
import type {
  ClinicalRuntimeStatus,
  EnvironmentId,
  LinceiRequest,
  PreviewAdjustInput,
  ScopedThreadRef,
} from "@t3tools/contracts";

import { resolveDiscoveredServerUrl } from "~/browser/browserTargetResolver";
import { type OpenPreviewMutation, openUrlInPreview } from "~/browser/openFileInPreview";
import { isPreviewAvailableFor, previewRuntimeFor } from "~/browser/previewRuntime";
import { readThreadPreviewState, setActivePreviewTab } from "~/previewStateStore";
import { useRightPanelStore } from "~/rightPanelStore";

import {
  classifyLinceiFailure,
  describeLinceiFailure,
  type LinceiCommandResult,
} from "./linceiAnswers";
import { BOARD_NEEDS_BROWSER, findBoardTab, isBoardPage } from "./researchBoardLogic";

export type BoardOpening =
  /** The board is on screen, in a tab that was there or a new one. */
  | { readonly _tag: "Shown" }
  /** Vitrine is not installed, or not yet: the server answered with how far setup is. */
  | { readonly _tag: "SettingUp"; readonly status: ClinicalRuntimeStatus }
  /** `message` is null when there is nothing to tell the user: the request was dropped. */
  | { readonly _tag: "Unavailable"; readonly message: string | null };

export interface BoardTarget {
  readonly threadRef: ScopedThreadRef;
  /** The folder the thread works in, where its study lives. */
  readonly cwd: string;
  readonly request: (target: {
    readonly environmentId: EnvironmentId;
    readonly input: LinceiRequest;
  }) => Promise<LinceiCommandResult>;
  readonly openPreview: OpenPreviewMutation;
  /** Upstream's command for how a browser tab on the server renders. */
  readonly adjustPreview: (target: {
    readonly environmentId: EnvironmentId;
    readonly input: PreviewAdjustInput;
  }) => Promise<unknown>;
}

/**
 * Gives the board's tab the appearance the app has now. A tab that agents can
 * drive too is rendered through upstream's browser driver, which shows pages
 * light unless told otherwise, so a board left to "follow the system" would be
 * a white page beside a dark app. Asked again each time the board is shown,
 * which is how it follows a change of theme.
 */
function matchAppAppearance(
  { threadRef, adjustPreview }: Pick<BoardTarget, "threadRef" | "adjustPreview">,
  tabId: string | null,
): void {
  if (tabId === null) return;
  const tab = readThreadPreviewState(threadRef).sessions[tabId];
  if (tab === undefined || tab.runtime !== "server") return;
  const colorScheme = document.documentElement.classList.contains("dark") ? "dark" : "light";
  if (tab.colorScheme === colorScheme) return;
  // Appearance only: a board that stays light is still the board.
  void adjustPreview({
    environmentId: threadRef.environmentId,
    input: { threadId: threadRef.threadId, tabId: tab.tabId, colorScheme },
  }).catch(() => undefined);
}

/**
 * Gives the thread's boards the app's appearance again. A board keeps the one
 * it was shown with, so this runs when the app switches between light and
 * dark while a board is open.
 */
export function followAppAppearance(target: Pick<BoardTarget, "threadRef" | "adjustPreview">) {
  for (const tab of Object.values(readThreadPreviewState(target.threadRef).sessions)) {
    if (tab.navStatus._tag !== "Loading" && tab.navStatus._tag !== "Success") continue;
    if (isBoardPage(tab.navStatus.url)) matchAppAppearance(target, tab.tabId);
  }
}

async function showBoard(target: BoardTarget): Promise<BoardOpening> {
  const { threadRef, cwd, request, openPreview } = target;
  // The button does not offer the board in such a window. This is for a
  // window that lost its browser between the button's render and the click.
  if (!isPreviewAvailableFor(threadRef.environmentId)) {
    return { _tag: "Unavailable", message: BOARD_NEEDS_BROWSER };
  }
  const started = await request({
    environmentId: threadRef.environmentId,
    input: { _tag: "ResearchBoardOpen", cwd },
  });
  if (started._tag === "Failure") {
    return {
      _tag: "Unavailable",
      message: describeLinceiFailure(classifyLinceiFailure(started.cause)),
    };
  }
  if (started.value._tag === "Clinical") {
    return { _tag: "SettingUp", status: started.value.status };
  }
  if (started.value._tag !== "ResearchBoard") {
    return { _tag: "Unavailable", message: "The research board did not say where it is." };
  }

  const { board } = started.value;
  // A browser tab that runs on the server reaches Vitrine's own address. A
  // tab on this machine needs a loopback URL the resolver can route.
  const url =
    previewRuntimeFor(threadRef.environmentId) === "server"
      ? board.url
      : resolveDiscoveredServerUrl(threadRef.environmentId, `http://127.0.0.1:${board.port}/`);

  const tabId = findBoardTab(readThreadPreviewState(threadRef).sessions, url);
  if (tabId !== null) {
    setActivePreviewTab(threadRef, tabId);
    useRightPanelStore.getState().openBrowser(threadRef, tabId);
    matchAppAppearance(target, tabId);
    return { _tag: "Shown" };
  }
  const opened = await openUrlInPreview({ threadRef, url, openPreview });
  if (opened._tag === "Success") {
    matchAppAppearance(target, findBoardTab(readThreadPreviewState(threadRef).sessions, url));
    return { _tag: "Shown" };
  }
  // The board is running; it is upstream's browser that did not take the tab.
  return {
    _tag: "Unavailable",
    message: isAtomCommandInterrupted(opened)
      ? null
      : "The research board is running, but Lincei could not open a tab for it. Try again.",
  };
}

/** Boards being opened, by thread. */
const opening = new Map<string, Promise<BoardOpening>>();

/**
 * Shows the board for a thread. Asking again while an earlier request for the
 * same thread is still on its way joins that one: a click that lands while
 * the board is opening by itself must not open a second tab.
 */
export function openResearchBoard(target: BoardTarget): Promise<BoardOpening> {
  const key = scopedThreadKey(target.threadRef);
  const pending = opening.get(key);
  if (pending !== undefined) return pending;
  const next = showBoard(target)
    .catch(
      (): BoardOpening => ({
        _tag: "Unavailable",
        message: "The research board could not be opened.",
      }),
    )
    .finally(() => opening.delete(key));
  opening.set(key, next);
  return next;
}
