/**
 * The decisions behind the research board button, kept free of React and the
 * app's stores so they can be tested: where a window shows a board, which
 * browser tab already shows one, when a study's activity is news, and what the
 * button says.
 */
import type { PreviewRuntime, PreviewSessionSnapshot } from "@t3tools/contracts";
import { isLocalLoopbackHost } from "@t3tools/shared/hostClassification";
import { isLoopbackHost } from "@t3tools/shared/preview";

import { CLINICAL_ACCESS_REFUSED, type ClinicalStatusView } from "./linceiAnswers";

/**
 * Where a page is served from. A machine's own names for itself count as one
 * place: Vitrine calls its board `vitrine.localhost` and its API `127.0.0.1`,
 * and both are the one server on that port.
 */
function servedFrom(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl);
    const self = isLoopbackHost(url.hostname) || url.hostname.endsWith(".localhost");
    const port = url.port || (url.protocol === "https:" ? "443" : "80");
    return `${url.protocol}//${self ? "loopback" : url.hostname}:${port}`;
  } catch {
    return null;
  }
}

/**
 * Where a window shows a research board: in the right panel, which takes
 * Lincei's built-in browser (the desktop app's, or one the server runs), or in
 * a browser tab of its own. Null where it cannot be shown at all.
 */
export type BoardPlace = "panel" | "tab" | null;

/**
 * Where this window shows a board. Vitrine listens on the loopback address of
 * the computer the server runs on, so a plain browser reaches it only on that
 * computer, which it is when it reaches the server at a loopback address too.
 * `serverUrl` is the address this window connects to the server at.
 */
export function boardPlace(input: {
  /** Whether a tab in the right panel's browser reaches the board (`boardTabRuntime`). */
  readonly panelReachesBoard: boolean;
  readonly serverUrl: string | null;
}): BoardPlace {
  if (input.panelReachesBoard) return "panel";
  if (input.serverUrl === null || !URL.canParse(input.serverUrl)) return null;
  const { hostname } = new URL(input.serverUrl);
  // Browsers resolve every `*.localhost` name to the loopback address.
  return isLocalLoopbackHost(hostname) || hostname.endsWith(".localhost") ? "tab" : null;
}

/** Whether a page is one of Vitrine's boards, which it names `vitrine.localhost` (`_DISPLAY_HOST`). */
export function isBoardPage(rawUrl: string): boolean {
  try {
    return new URL(rawUrl).hostname === "vitrine.localhost";
  } catch {
    return false;
  }
}

type BrowserTab = Pick<
  PreviewSessionSnapshot,
  "tabId" | "navStatus" | "runtime" | "reveal" | "updatedAt"
>;

/**
 * The thread's browser tab that is on the board at `boardUrl`, if it has one.
 * A board is one Vitrine server, so every page it serves counts: the user may
 * have gone from the board to one of its cards. A tab that could not load the
 * board is not on it, and sending the user there would look like the click
 * did nothing. Where several tabs qualify, the one used last wins.
 */
export function findBoardTab(
  tabs: Readonly<Record<string, BrowserTab>>,
  boardUrl: string,
): string | null {
  const board = servedFrom(boardUrl);
  if (board === null) return null;
  const candidates = Object.values(tabs).filter(
    (tab) =>
      (tab.navStatus._tag === "Loading" || tab.navStatus._tag === "Success") &&
      servedFrom(tab.navStatus.url) === board &&
      // A tab an agent opened for itself and has not shown is not the user's to be sent to.
      !(tab.runtime === "server" && tab.reveal === false),
  );
  return (
    candidates.toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0]?.tabId ??
    null
  );
}

/**
 * What a watcher has seen of a study: when it last changed, or when the turn
 * began, which is what the turn's cards are judged against. Null while the
 * study has no cards. Times are the server's epoch milliseconds.
 */
export interface BoardSighting {
  readonly updatedAt: number | null;
}

/**
 * Decides whether an answer about a study's activity is news: a change later
 * than the last one seen. Seeing it uses it up, so one card is reported once.
 * Without anything seen yet the answer is never news, because cards that were
 * there before the watcher looked are not what it waits for; it becomes the
 * baseline instead.
 */
export function noteBoardActivity(
  seen: BoardSighting | null,
  updatedAt: number | null,
): { readonly sighting: BoardSighting; readonly isNews: boolean } {
  if (seen === null) return { sighting: { updatedAt }, isNews: false };
  if (updatedAt === null) return { sighting: seen, isNews: false };
  if (seen.updatedAt !== null && updatedAt <= seen.updatedAt) {
    return { sighting: seen, isNews: false };
  }
  return { sighting: { updatedAt }, isNews: true };
}

export interface ResearchBoardWatcher {
  /**
   * A turn began at `startedAt`: look now, then every `intervalMs`. A change
   * after `startedAt` is news, including a card published before the first
   * look was answered. Where the start is not known (null) the first answer
   * is the baseline. A start that becomes known later in the turn is taken,
   * as long as nothing has been seen yet.
   */
  readonly start: (startedAt: number | null) => void;
  /**
   * The turn ended: look once more. A card published after the last regular
   * look would otherwise go unseen until the next turn made it old news.
   */
  readonly finish: () => void;
  /** Stops for good without a last look, for a thread that left the screen. */
  readonly dispose: () => void;
}

/**
 * Watches one study for cards while an agent works. `readActivity` answers
 * when the study last changed: null while it has no cards, undefined when it
 * could not be asked, which teaches the watcher nothing.
 */
export function createResearchBoardWatcher(input: {
  readonly readActivity: () => Promise<number | null | undefined>;
  readonly onNews: () => void;
  readonly intervalMs: number;
}): ResearchBoardWatcher {
  // Each turn keeps its own baseline, so the last look of one turn is still
  // judged against that turn when the next has already begun.
  let turn: { seen: BoardSighting | null } | null = null;
  const since = (startedAt: number | null): BoardSighting | null =>
    startedAt === null ? null : { updatedAt: startedAt };
  let timer: ReturnType<typeof setInterval> | undefined;
  let disposed = false;

  const look = async (during: { seen: BoardSighting | null }) => {
    const updatedAt = await input.readActivity().catch(() => undefined);
    if (disposed || updatedAt === undefined) return;
    const { sighting, isNews } = noteBoardActivity(during.seen, updatedAt);
    during.seen = sighting;
    if (isNews) input.onNews();
  };

  return {
    start: (startedAt) => {
      if (disposed) return;
      if (timer !== undefined) {
        // The thread can say when its turn began a moment after it began.
        if (turn !== null && turn.seen === null) turn.seen = since(startedAt);
        return;
      }
      const current: { seen: BoardSighting | null } = { seen: since(startedAt) };
      turn = current;
      timer = setInterval(() => void look(current), input.intervalMs);
      void look(current);
    },
    finish: () => {
      if (disposed || timer === undefined || turn === null) return;
      clearInterval(timer);
      timer = undefined;
      void look(turn);
    },
    dispose: () => {
      disposed = true;
      clearInterval(timer);
      timer = undefined;
    },
  };
}

/**
 * Keeps watchers by key, apart from whoever is using them, so that a user who
 * goes away and is replaced at once does not take the watcher along: it would
 * forget what its turn started from, and drop a last look that was on its
 * way. A watcher nobody holds is disposed a moment later, which is the moment
 * a replacement has to take it over.
 *
 * `later` runs a task after that moment and returns how to call it off.
 */
export function createWatcherKeeper(
  later: (task: () => void) => () => void = (task) => {
    const timer = setTimeout(task, 0);
    return () => clearTimeout(timer);
  },
): {
  /** The watcher kept under `key`, made by `create` when there is none. Call `release` when done with it. */
  readonly hold: (
    key: string,
    create: () => ResearchBoardWatcher,
  ) => { readonly watcher: ResearchBoardWatcher; readonly release: () => void };
} {
  const kept = new Map<
    string,
    {
      readonly watcher: ResearchBoardWatcher;
      holders: number;
      /** Calls off the disposal that is waiting, when there is one. */
      spare: (() => void) | undefined;
    }
  >();
  return {
    hold: (key, create) => {
      const entry = kept.get(key) ?? { watcher: create(), holders: 0, spare: undefined };
      kept.set(key, entry);
      entry.holders += 1;
      entry.spare?.();
      entry.spare = undefined;
      let released = false;
      return {
        watcher: entry.watcher,
        release: () => {
          if (released) return;
          released = true;
          entry.holders -= 1;
          if (entry.holders > 0) return;
          entry.spare = later(() => {
            entry.watcher.dispose();
            if (kept.get(key) === entry) kept.delete(key);
          });
        },
      };
    },
  };
}

/**
 * Where a board's browser tab runs, or null when this window has no browser
 * that reaches it. Vitrine answers on loopback only, so a tab reaches a board
 * only when it runs on the server's computer: in the server's own browser, or
 * in this window's browser when this window runs there too. Upstream opens
 * the tabs of an environment elsewhere in this window's browser, which would
 * look for the board on this computer; the board's tab runs on the server
 * instead.
 */
export function boardTabRuntime(input: {
  /** Where upstream runs a tab the user opens: on the server, or (undefined) in this window. */
  readonly preferred: PreviewRuntime | undefined;
  /** Whether this window has a browser of its own that runs on the server's computer. */
  readonly ownBrowserBesideServer: boolean;
  /** Whether the server can run browser tabs. */
  readonly serverBrowser: boolean;
}): PreviewRuntime | null {
  if (input.preferred !== undefined) return input.preferred;
  if (input.ownBrowserBesideServer) return "desktop";
  return input.serverBrowser ? "server" : null;
}

export const BOARD_NEEDS_BROWSER =
  "The research board opens only on the computer Lincei runs on. Open Lincei in a browser on that computer, or in the Lincei app.";

export const BOARD_TAB_REFUSED =
  "The browser did not open a tab for the research board. Allow pop-ups for Lincei and try again.";

export type BoardButtonMarker = "none" | "working" | "failed";

export interface BoardButton {
  /** The tooltip and accessible name. When the button is disabled it gives the reason. */
  readonly label: string;
  readonly marker: BoardButtonMarker;
  readonly enabled: boolean;
}

/**
 * What the research board button shows for what is known about the clinical
 * research tools. Null hides it: the server is not Lincei.
 */
export function describeBoardButton(input: {
  readonly view: ClinicalStatusView;
  /** Whether the thread works in a folder, which is where its study lives. */
  readonly hasFolder: boolean;
  /** Where this window shows a board. */
  readonly place: BoardPlace;
  /** Whether this connection may start anything on the server. */
  readonly canOperate: boolean;
}): BoardButton | null {
  const { view, hasFolder, place, canOperate } = input;
  const canShowBoard = place !== null;
  const open = place === "tab" ? "Open research board in a new tab" : "Open research board";
  switch (view.phase) {
    case "absent":
      return null;
    case "loading":
      return { label: "Checking the clinical research tools…", marker: "none", enabled: false };
    case "forbidden":
      return { label: CLINICAL_ACCESS_REFUSED, marker: "none", enabled: false };
    case "failed":
      return {
        label: "Could not check the clinical research tools. Click to try again.",
        marker: "failed",
        enabled: true,
      };
    case "known":
      break;
  }
  if (!canOperate) return { label: CLINICAL_ACCESS_REFUSED, marker: "none", enabled: false };
  const { status } = view;
  switch (status.state) {
    case "installing":
      // Vitrine is installed before the demo dataset, so the board already opens.
      return {
        label:
          status.step === "dataset" && hasFolder && canShowBoard
            ? `${open}. ${status.message}`
            : `Setting up the clinical research tools. ${status.message}`,
        marker: "working",
        // A click asks the server for the board, which takes a folder and somewhere to show it.
        enabled: hasFolder && canShowBoard,
      };
    case "failed":
      // The status says why and what to check, at a length that is for a page.
      return {
        label:
          "Setting up the clinical research tools failed. Click to try again. Settings, Clinical Data says why.",
        marker: "failed",
        enabled: true,
      };
    case "not-installed":
      return { label: "Set up the clinical research tools", marker: "none", enabled: true };
    case "ready":
      if (!canShowBoard) return { label: BOARD_NEEDS_BROWSER, marker: "none", enabled: false };
      return hasFolder
        ? { label: open, marker: "none", enabled: true }
        : {
            label: "Open a project to see its research board",
            marker: "none",
            enabled: false,
          };
  }
}
