/**
 * The decisions behind the research board button, kept free of React and the
 * app's stores so they can be tested: which browser tab already shows a board,
 * when a study's activity is news, and what the button says.
 */
import type { PreviewSessionSnapshot } from "@t3tools/contracts";
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

/** When a watcher last saw a study change; `updatedAt` is null while the study has no cards. */
export interface BoardSighting {
  readonly updatedAt: number | null;
}

/**
 * Decides whether an answer about a study's activity is news. The first
 * answer never is: cards that were there before the watcher looked are not
 * what it waits for. After that, news is a change later than the last one
 * seen, and seeing it uses it up, so one card is reported once.
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
  /** A turn began: look now, then every `intervalMs`. What is there now is this turn's baseline. */
  readonly start: () => void;
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
    start: () => {
      if (disposed || timer !== undefined) return;
      const current = { seen: null };
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

export const BOARD_NEEDS_BROWSER =
  "The research board needs Lincei's built-in browser, which this window does not have. Open the thread in the Lincei app.";

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
  /** Whether this window has a browser to show a board in. */
  readonly canShowBoard: boolean;
  /** Whether this connection may start anything on the server. */
  readonly canOperate: boolean;
}): BoardButton | null {
  const { view, hasFolder, canShowBoard, canOperate } = input;
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
            ? `Open research board. ${status.message}`
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
        ? { label: "Open research board", marker: "none", enabled: true }
        : {
            label: "Open a project to see its research board",
            marker: "none",
            enabled: false,
          };
  }
}
