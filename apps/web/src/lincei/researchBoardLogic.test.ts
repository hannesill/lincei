import type { ClinicalRuntimeStatus, PreviewSessionSnapshot } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { CLINICAL_ACCESS_REFUSED } from "./linceiAnswers";
import {
  BOARD_NEEDS_BROWSER,
  createResearchBoardWatcher,
  createWatcherKeeper,
  describeBoardButton,
  findBoardTab,
  isBoardPage,
  noteBoardActivity,
} from "./researchBoardLogic";

type Tab = Pick<PreviewSessionSnapshot, "tabId" | "navStatus" | "runtime" | "reveal" | "updatedAt">;

const tab = (tabId: string, url: string | null, fields: Partial<Tab> = {}): Tab => ({
  tabId: tabId as Tab["tabId"],
  navStatus: url === null ? { _tag: "Idle" } : { _tag: "Success", url, title: "vitrine" },
  updatedAt: "2026-10-13T10:00:00.000Z",
  ...fields,
});

const tabs = (...list: ReadonlyArray<Tab>) =>
  Object.fromEntries(list.map((entry) => [entry.tabId, entry]));

describe("isBoardPage", () => {
  it("knows Vitrine's boards by the name Vitrine gives them, on any port and page", () => {
    expect(isBoardPage("http://vitrine.localhost:7741/")).toBe(true);
    expect(isBoardPage("http://vitrine.localhost:7750/#/study/demo")).toBe(true);
    expect(isBoardPage("http://localhost:7741/")).toBe(false);
    expect(isBoardPage("https://physionet.org/")).toBe(false);
    expect(isBoardPage("not a url")).toBe(false);
  });
});

describe("findBoardTab", () => {
  const board = "http://127.0.0.1:7741/";

  it("finds the tab that is already on the board, wherever in the board it is", () => {
    const open = tabs(
      tab("tab_1", "https://physionet.org/"),
      tab("tab_2", "http://127.0.0.1:7741/studies/sepsis#card-3"),
    );
    expect(findBoardTab(open, board)).toBe("tab_2");
  });

  it("reads localhost and 127.0.0.1 as the same computer", () => {
    expect(findBoardTab(tabs(tab("tab_1", "http://localhost:7741/")), board)).toBe("tab_1");
  });

  it("knows Vitrine's own name for the board, whichever address the tab was opened at", () => {
    const named = tabs(tab("tab_1", "http://vitrine.localhost:7741/studies/sepsis"));
    expect(findBoardTab(named, "http://vitrine.localhost:7741")).toBe("tab_1");
    expect(findBoardTab(named, board)).toBe("tab_1");
    expect(findBoardTab(named, "http://vitrine.localhost:7742")).toBeNull();
  });

  it("finds a board that is still loading, so a second click does not open a second tab", () => {
    const loading = tab("tab_1", null, {
      navStatus: { _tag: "Loading", url: board, title: "" },
    });
    expect(findBoardTab(tabs(loading), board)).toBe("tab_1");
  });

  it("does not send the user to a tab that failed to load the board", () => {
    const failed = tab("tab_1", null, {
      navStatus: {
        _tag: "LoadFailed",
        url: board,
        title: "",
        code: -102,
        description: "ERR_CONNECTION_REFUSED",
      },
    });
    expect(findBoardTab(tabs(failed), board)).toBeNull();
    expect(findBoardTab(tabs(failed, tab("tab_2", board)), board)).toBe("tab_2");
  });

  it("finds nothing on another port, on an empty tab, or without tabs", () => {
    expect(findBoardTab(tabs(tab("tab_1", "http://127.0.0.1:7742/")), board)).toBeNull();
    expect(findBoardTab(tabs(tab("tab_1", null)), board)).toBeNull();
    expect(findBoardTab({}, board)).toBeNull();
  });

  it("leaves an agent's own hidden tab alone", () => {
    const hidden = tab("tab_1", board, { runtime: "server", reveal: false });
    expect(findBoardTab(tabs(hidden), board)).toBeNull();
  });

  it("prefers the tab used last when the board is open twice", () => {
    const open = tabs(
      tab("tab_1", board, { updatedAt: "2026-10-13T10:00:00.000Z" }),
      tab("tab_2", board, { updatedAt: "2026-10-13T11:00:00.000Z" }),
    );
    expect(findBoardTab(open, board)).toBe("tab_2");
  });
});

describe("noteBoardActivity", () => {
  it("takes the first answer as the baseline, cards and all", () => {
    expect(noteBoardActivity(null, 500)).toEqual({ sighting: { updatedAt: 500 }, isNews: false });
    expect(noteBoardActivity(null, null)).toEqual({ sighting: { updatedAt: null }, isNews: false });
  });

  it("reports a change later than the last one seen", () => {
    expect(noteBoardActivity({ updatedAt: 500 }, 900)).toEqual({
      sighting: { updatedAt: 900 },
      isNews: true,
    });
  });

  it("reports the first card of a study that had none", () => {
    expect(noteBoardActivity({ updatedAt: null }, 900).isNews).toBe(true);
  });

  it("reports nothing for the same or an older time, or a study without cards", () => {
    const seen = { updatedAt: 500 };
    expect(noteBoardActivity(seen, 500)).toEqual({ sighting: seen, isNews: false });
    expect(noteBoardActivity(seen, 400)).toEqual({ sighting: seen, isNews: false });
    expect(noteBoardActivity(seen, null)).toEqual({ sighting: seen, isNews: false });
  });

  it("reports one card once", () => {
    const first = noteBoardActivity({ updatedAt: 500 }, 900);
    expect(noteBoardActivity(first.sighting, 900).isNews).toBe(false);
  });
});

describe("createResearchBoardWatcher", () => {
  /** A study whose activity the test sets, and a watcher that never ticks by itself. */
  const watch = () => {
    const study = { updatedAt: null as number | null | undefined, looks: 0, news: 0 };
    const watcher = createResearchBoardWatcher({
      readActivity: async () => {
        study.looks += 1;
        return study.updatedAt;
      },
      onNews: () => {
        study.news += 1;
      },
      intervalMs: 60 * 60_000,
    });
    // A look awaits the answer and then judges it, so let both finish.
    const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
    return { study, watcher, settle };
  };

  it("sees a card published between the last look and the end of the turn", async () => {
    const { study, watcher, settle } = watch();
    study.updatedAt = 500;
    watcher.start(null);
    await settle();
    study.updatedAt = 900;
    watcher.finish();
    await settle();
    expect(study).toMatchObject({ looks: 2, news: 1 });
  });

  it("does not report what was there when the turn began", async () => {
    const { study, watcher, settle } = watch();
    study.updatedAt = 500;
    watcher.start(null);
    await settle();
    watcher.finish();
    await settle();
    expect(study.news).toBe(0);
  });

  it("starts each turn from what is there then", async () => {
    const { study, watcher, settle } = watch();
    study.updatedAt = 500;
    watcher.start(null);
    await settle();
    watcher.finish();
    await settle();
    // Another thread of the project adds a card between this thread's turns.
    study.updatedAt = 900;
    watcher.start(null);
    await settle();
    watcher.finish();
    await settle();
    expect(study.news).toBe(0);
  });

  it("reports a card the turn published before its first look was answered", async () => {
    const { study, watcher, settle } = watch();
    // The turn began at 700; by the time the first look is answered it has a card.
    study.updatedAt = 900;
    watcher.start(700);
    await settle();
    expect(study.news).toBe(1);
  });

  it("judges against the turn's start, not what the first look found", async () => {
    const { study, watcher, settle } = watch();
    study.updatedAt = 500;
    watcher.start(700);
    await settle();
    expect(study.news).toBe(0);
    study.updatedAt = 900;
    watcher.finish();
    await settle();
    expect(study.news).toBe(1);
  });

  it("takes the turn's start when it is known only after the turn began", async () => {
    const { study, watcher, settle } = watch();
    study.updatedAt = 900;
    watcher.start(null);
    watcher.start(700);
    await settle();
    expect(study.news).toBe(1);
  });

  it("learns nothing from a look that could not be answered", async () => {
    const { study, watcher, settle } = watch();
    study.updatedAt = undefined;
    watcher.start(null);
    await settle();
    study.updatedAt = 900;
    watcher.finish();
    await settle();
    // The failed look left no baseline, so this answer became it.
    expect(study.news).toBe(0);
  });

  it("looks no more once disposed, and has no last look without a turn", async () => {
    const { study, watcher, settle } = watch();
    watcher.finish();
    await settle();
    expect(study.looks).toBe(0);
    watcher.dispose();
    watcher.start(null);
    await settle();
    expect(study.looks).toBe(0);
  });
});

describe("createWatcherKeeper", () => {
  /** A keeper whose "a moment later" the test runs itself, and watchers that count their looks. */
  const keep = () => {
    const waiting: Array<() => void> = [];
    const counts = { made: 0, looks: 0 };
    const keeper = createWatcherKeeper((task) => {
      waiting.push(task);
      return () => void waiting.splice(waiting.indexOf(task), 1);
    });
    const create = () => {
      counts.made += 1;
      return createResearchBoardWatcher({
        readActivity: async () => {
          counts.looks += 1;
          return null;
        },
        onNews: () => {},
        intervalMs: 60 * 60_000,
      });
    };
    const aMomentLater = () => {
      for (const task of waiting.splice(0)) task();
    };
    return { keeper, create, counts, aMomentLater };
  };

  it("hands a turn's watcher to the holder that takes over at once", () => {
    const { keeper, create, counts, aMomentLater } = keep();
    const first = keeper.hold("thread", create);
    first.watcher.start(null);
    first.release();
    const second = keeper.hold("thread", create);
    aMomentLater();
    expect(second.watcher).toBe(first.watcher);
    expect(counts.made).toBe(1);
    // Still the running watcher of that turn: its last look happens.
    second.watcher.finish();
    expect(counts.looks).toBe(2);
    second.watcher.dispose();
  });

  it("disposes a watcher nobody took over, and makes a new one when asked again", () => {
    const { keeper, create, counts, aMomentLater } = keep();
    const first = keeper.hold("thread", create);
    first.watcher.start(null);
    first.release();
    aMomentLater();
    first.watcher.finish();
    expect(counts.looks).toBe(1);
    const second = keeper.hold("thread", create);
    expect(second.watcher).not.toBe(first.watcher);
    expect(counts.made).toBe(2);
  });

  it("keeps a watcher while another holder is still there, whoever lets go first", () => {
    const { keeper, create, counts, aMomentLater } = keep();
    const first = keeper.hold("thread", create);
    const second = keeper.hold("thread", create);
    first.release();
    first.release();
    aMomentLater();
    second.watcher.start(null);
    expect(counts.looks).toBe(1);
    second.watcher.dispose();
  });

  it("keeps threads apart", () => {
    const { keeper, create, counts } = keep();
    expect(keeper.hold("one", create).watcher).not.toBe(keeper.hold("two", create).watcher);
    expect(counts.made).toBe(2);
  });
});

describe("describeBoardButton", () => {
  const status = (fields: Partial<ClinicalRuntimeStatus>): ClinicalRuntimeStatus => ({
    state: "ready",
    message: "",
    home: "",
    python: "",
    skillsDir: "",
    dataDir: "",
    requirements: [],
    demoDataset: "ready",
    ...fields,
  });
  /** A thread with a folder, in a window with a browser, on a connection that may act. */
  const usual = { hasFolder: true, canShowBoard: true, canOperate: true };
  const known = (fields: Partial<ClinicalRuntimeStatus>, where: Partial<typeof usual> = {}) =>
    describeBoardButton({
      view: { phase: "known", status: status(fields) },
      ...usual,
      ...where,
    });

  it("is hidden only against a server that is not Lincei", () => {
    expect(describeBoardButton({ view: { phase: "absent" }, ...usual })).toBeNull();
    for (const view of [
      { phase: "loading" } as const,
      { phase: "forbidden" } as const,
      { phase: "failed", message: "No answer.", detail: null } as const,
    ]) {
      expect(describeBoardButton({ view, ...usual })).not.toBeNull();
    }
  });

  it("offers a retry when the tools could not be checked", () => {
    expect(
      describeBoardButton({
        view: { phase: "failed", message: "No answer.", detail: null },
        ...usual,
      }),
    ).toEqual({
      label: "Could not check the clinical research tools. Click to try again.",
      marker: "failed",
      enabled: true,
    });
  });

  it("opens the board once the tools are there, during the demo download too", () => {
    expect(known({})).toEqual({ label: "Open research board", marker: "none", enabled: true });
    expect(
      known({ state: "installing", step: "dataset", message: "Downloading the demo." }),
    ).toEqual({
      label: "Open research board. Downloading the demo.",
      marker: "working",
      enabled: true,
    });
  });

  it("shows setup that is running, failed, or not started", () => {
    expect(known({ state: "installing", step: "packages", message: "Installing." })).toMatchObject({
      label: "Setting up the clinical research tools. Installing.",
      marker: "working",
    });
    expect(known({ state: "failed", step: "packages", message: "No network." })).toMatchObject({
      label:
        "Setting up the clinical research tools failed. Click to try again. Settings, Clinical Data says why.",
      marker: "failed",
      enabled: true,
    });
    expect(known({ state: "not-installed" })).toMatchObject({
      label: "Set up the clinical research tools",
      enabled: true,
    });
  });

  it("says why it is disabled", () => {
    expect(known({}, { hasFolder: false })).toEqual({
      label: "Open a project to see its research board",
      marker: "none",
      enabled: false,
    });
    expect(known({}, { canOperate: false })).toEqual({
      label: CLINICAL_ACCESS_REFUSED,
      marker: "none",
      enabled: false,
    });
    expect(known({}, { canShowBoard: false })).toEqual({
      label: BOARD_NEEDS_BROWSER,
      marker: "none",
      enabled: false,
    });
  });

  it("still starts setup where there is no board to open", () => {
    for (const where of [{ hasFolder: false }, { canShowBoard: false }]) {
      expect(known({ state: "not-installed" }, where)?.enabled).toBe(true);
      expect(known({ state: "failed", step: "uv" }, where)?.enabled).toBe(true);
      expect(known({ state: "installing", step: "uv", message: "Getting ready." }, where)).toEqual({
        label: "Setting up the clinical research tools. Getting ready.",
        marker: "working",
        enabled: false,
      });
    }
  });

  it("does not promise a board during the demo download when it cannot show one", () => {
    const downloading = { state: "installing", step: "dataset", message: "Downloading." } as const;
    expect(known(downloading, { canShowBoard: false })).toEqual({
      label: "Setting up the clinical research tools. Downloading.",
      marker: "working",
      enabled: false,
    });
  });
});
