import { scopeSessionRef } from "@t3tools/client-runtime";
import { type EnvironmentId, type PreviewSessionSnapshot, SessionId } from "@t3tools/contracts";
import { beforeEach, describe, expect, it } from "vitest";

import { __testing, selectSessionPreviewState, usePreviewStateStore } from "./previewStateStore";

const sessionId = SessionId.make("session-1");
const ref = scopeSessionRef("env-1" as EnvironmentId, sessionId);

const makeSnapshot = (overrides: Partial<PreviewSessionSnapshot> = {}): PreviewSessionSnapshot => ({
  sessionId,
  tabId: "tab-a",
  navStatus: { _tag: "Loading", url: "http://localhost:5173/", title: "" },
  canGoBack: false,
  canGoForward: false,
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

beforeEach(() => {
  usePreviewStateStore.setState({ bySessionKey: {} });
  __testing.resetRevisions();
});

describe("previewStateStore", () => {
  it("tracks multiple tabs and focuses the newest opened tab", () => {
    const first = makeSnapshot();
    const second = makeSnapshot({
      tabId: "tab-b",
      updatedAt: "2026-01-01T00:00:01.000Z",
    });
    const store = usePreviewStateStore.getState();
    for (const snapshot of [first, second]) {
      store.applyServerEvent(ref, {
        type: "opened",
        sessionId,
        tabId: snapshot.tabId,
        createdAt: snapshot.updatedAt,
        snapshot,
      });
    }

    const state = selectSessionPreviewState(usePreviewStateStore.getState().bySessionKey, ref);
    expect(Object.keys(state.sessions)).toEqual(["tab-a", "tab-b"]);
    expect(state.activeTabId).toBe("tab-b");
  });

  it("ignores an older event for an already-newer tab", () => {
    const newer = makeSnapshot({
      navStatus: { _tag: "Success", url: "http://localhost:5173/new", title: "New" },
      updatedAt: "2026-01-01T00:00:02.000Z",
    });
    const older = makeSnapshot({
      navStatus: { _tag: "Success", url: "http://localhost:5173/old", title: "Old" },
      updatedAt: "2026-01-01T00:00:01.000Z",
    });
    const store = usePreviewStateStore.getState();
    store.applyServerSnapshot(ref, newer);
    store.applyServerEvent(ref, {
      type: "navigated",
      sessionId,
      tabId: older.tabId,
      createdAt: older.updatedAt,
      snapshot: older,
    });

    expect(
      selectSessionPreviewState(usePreviewStateStore.getState().bySessionKey, ref).snapshot
        ?.navStatus,
    ).toEqual(newer.navStatus);
  });

  it("closing the active tab falls back to the freshest remaining tab", () => {
    const first = makeSnapshot();
    const second = makeSnapshot({
      tabId: "tab-b",
      updatedAt: "2026-01-01T00:00:01.000Z",
    });
    const store = usePreviewStateStore.getState();
    store.replaceServerSnapshots(ref, [first, second]);
    store.setActiveTab(ref, second.tabId);
    store.applyServerEvent(ref, {
      type: "closed",
      sessionId,
      tabId: second.tabId,
      createdAt: "2026-01-01T00:00:02.000Z",
    });

    const state = selectSessionPreviewState(usePreviewStateStore.getState().bySessionKey, ref);
    expect(state.activeTabId).toBe(first.tabId);
    expect(state.snapshot?.tabId).toBe(first.tabId);
  });

  it("replaces server state without retaining tabs absent from hydration", () => {
    const first = makeSnapshot();
    const second = makeSnapshot({ tabId: "tab-b" });
    const store = usePreviewStateStore.getState();
    store.replaceServerSnapshots(ref, [first, second]);
    store.replaceServerSnapshots(ref, [second]);

    const state = selectSessionPreviewState(usePreviewStateStore.getState().bySessionKey, ref);
    expect(Object.keys(state.sessions)).toEqual(["tab-b"]);
  });

  it("keeps desktop state per tab and caps recent URLs", () => {
    const store = usePreviewStateStore.getState();
    store.applyServerSnapshot(ref, makeSnapshot());
    store.applyDesktopState(ref, "tab-a", {
      canGoBack: true,
      canGoForward: false,
      loading: false,
      zoomFactor: 1.25,
    });
    for (let index = 0; index < __testing.RECENT_URL_LIMIT + 5; index += 1) {
      store.rememberUrl(ref, `http://localhost:${5000 + index}/`);
    }

    const state = selectSessionPreviewState(usePreviewStateStore.getState().bySessionKey, ref);
    expect(state.desktopOverlay?.canGoBack).toBe(true);
    expect(state.recentlySeenUrls).toHaveLength(__testing.RECENT_URL_LIMIT);
    expect(state.recentlySeenUrls[0]).toBe(
      `http://localhost:${5000 + __testing.RECENT_URL_LIMIT + 4}/`,
    );
  });
});
