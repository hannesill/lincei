import { scopeSessionRef } from "@t3tools/client-runtime";
import type { EnvironmentApi, EnvironmentId, PreviewSessionSnapshot } from "@t3tools/contracts";
import { SessionId } from "@t3tools/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { usePreviewStateStore } from "~/previewStateStore";

import { openPreviewSession } from "./openPreviewSession";

const sessionRef = scopeSessionRef("local" as EnvironmentId, SessionId.make("preview-session-1"));
const snapshot: PreviewSessionSnapshot = {
  sessionId: sessionRef.sessionId,
  tabId: "tab-1",
  navStatus: {
    _tag: "Loading",
    url: "https://example.com/",
    title: "",
  },
  canGoBack: false,
  canGoForward: false,
  updatedAt: "2026-07-22T18:00:00.000Z",
};

beforeEach(() => {
  usePreviewStateStore.setState({ bySessionKey: {} });
});

describe("openPreviewSession", () => {
  it("applies the RPC response immediately", async () => {
    const open = vi.fn(async () => snapshot);

    const result = await openPreviewSession({
      previewApi: { open } as Pick<EnvironmentApi["preview"], "open">,
      sessionRef,
      url: "example.com",
    });

    expect(result).toBe(snapshot);
    expect(open).toHaveBeenCalledWith({
      sessionId: sessionRef.sessionId,
      url: "https://example.com/",
    });
    expect(usePreviewStateStore.getState().bySessionKey).not.toEqual({});
  });

  it("focuses a hydrated same-URL tab without opening a duplicate", async () => {
    const other = {
      ...snapshot,
      tabId: "tab-2",
      navStatus: { _tag: "Success" as const, url: "https://other.example/", title: "Other" },
    };
    const store = usePreviewStateStore.getState();
    store.replaceServerSnapshots(sessionRef, [snapshot, other]);
    store.setActiveTab(sessionRef, other.tabId);
    const open = vi.fn(async () => snapshot);

    const result = await openPreviewSession({
      previewApi: { open } as Pick<EnvironmentApi["preview"], "open">,
      sessionRef,
      url: "https://example.com",
    });

    expect(result).toBe(snapshot);
    expect(open).not.toHaveBeenCalled();
    expect(
      usePreviewStateStore.getState().bySessionKey["local:preview-session-1"]?.activeTabId,
    ).toBe(snapshot.tabId);
  });
});
