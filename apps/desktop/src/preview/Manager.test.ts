import { beforeEach, describe, expect, it, vi } from "vitest";

const { fromId, fromPartition, sessions } = vi.hoisted(() => ({
  fromId: vi.fn(),
  fromPartition: vi.fn(),
  sessions: new Map<string, ReturnType<typeof makeBrowserSession>>(),
}));

function makeBrowserSession() {
  return {
    clearCache: vi.fn(() => Promise.resolve()),
    clearStorageData: vi.fn(() => Promise.resolve()),
    getUserAgent: vi.fn(() => "Mozilla/5.0 Electron/41.5.0 Lincei/0.1.0"),
    setPermissionCheckHandler: vi.fn(),
    setPermissionRequestHandler: vi.fn(),
    setUserAgent: vi.fn(),
  };
}

vi.mock("electron", () => ({
  session: { fromPartition },
  webContents: { fromId },
}));

import { PreviewViewManager } from "./Manager.ts";

function makeMainWindow() {
  const webContents = {
    sendInputEvent: vi.fn(),
  };
  return {
    webContents,
    isDestroyed: vi.fn(() => false),
  };
}

function makeGuest(input: {
  readonly id?: number;
  readonly mainWebContents: object;
  readonly browserSession: object;
  readonly type?: string;
}) {
  const listeners = new Map<string, (...args: unknown[]) => void>();
  const guest = {
    id: input.id ?? 42,
    devToolsWebContents: null,
    hostWebContents: input.mainWebContents,
    session: input.browserSession,
    getTitle: vi.fn(() => ""),
    getType: vi.fn(() => input.type ?? "webview"),
    getURL: vi.fn(() => "about:blank"),
    isDestroyed: vi.fn(() => false),
    isDevToolsOpened: vi.fn(() => false),
    isLoading: vi.fn(() => false),
    loadURL: vi.fn(() => Promise.resolve()),
    navigationHistory: {
      canGoBack: vi.fn(() => false),
      canGoForward: vi.fn(() => false),
      goBack: vi.fn(),
      goForward: vi.fn(),
    },
    off: vi.fn(),
    on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
      listeners.set(event, listener);
    }),
    openDevTools: vi.fn(),
    reload: vi.fn(),
    reloadIgnoringCache: vi.fn(),
    setWindowOpenHandler: vi.fn(),
    setZoomFactor: vi.fn(),
  };
  return { guest, listeners };
}

describe("PreviewViewManager", () => {
  beforeEach(() => {
    sessions.clear();
    fromId.mockReset();
    fromPartition.mockReset();
    fromPartition.mockImplementation((partition: string) => {
      const browserSession = makeBrowserSession();
      sessions.set(partition, browserSession);
      return browserSession;
    });
  });

  it("does not create an Electron session at module load and scopes partitions deterministically", () => {
    const manager = new PreviewViewManager();

    expect(fromPartition).not.toHaveBeenCalled();
    const first = manager.getBrowserPartition("environment-a");
    const second = manager.getBrowserPartition("environment-a");
    const other = manager.getBrowserPartition("environment-b");

    expect(first).toBe(second);
    expect(first).toMatch(/^persist:lincei-preview-[a-f0-9]{20}$/);
    expect(other).not.toBe(first);

    manager.createTab("tab-1", "environment-a");
    manager.createTab("tab-1", "environment-a");
    expect(fromPartition).toHaveBeenCalledTimes(1);
  });

  it("grants only supported clipboard permissions through request and check handlers", () => {
    const manager = new PreviewViewManager();
    const mainWindow = makeMainWindow();
    manager.setMainWindow(mainWindow as never);
    manager.createTab("tab-1", "environment-a");

    const partition = manager.getBrowserPartition("environment-a");
    const browserSession = sessions.get(partition);
    expect(browserSession).toBeDefined();
    const guest = makeGuest({
      mainWebContents: mainWindow.webContents,
      browserSession: browserSession!,
    }).guest;

    const requestHandler = browserSession!.setPermissionRequestHandler.mock.calls[0]?.[0];
    const checkHandler = browserSession!.setPermissionCheckHandler.mock.calls[0]?.[0];
    expect(requestHandler).toBeTypeOf("function");
    expect(checkHandler).toBeTypeOf("function");

    const requested = (permission: string) => {
      let granted: boolean | undefined;
      requestHandler(guest, permission, (value: boolean) => {
        granted = value;
      });
      return granted;
    };

    for (const permission of ["clipboard-read", "clipboard-sanitized-write"]) {
      expect(requested(permission)).toBe(true);
      expect(checkHandler(guest, permission)).toBe(true);
    }
    for (const permission of ["clipboard-write", "notifications", "geolocation", "midi"]) {
      expect(requested(permission)).toBe(false);
      expect(checkHandler(guest, permission)).toBe(false);
    }
  });

  it("rejects webviews with the wrong type, host, or partition", () => {
    const manager = new PreviewViewManager();
    const mainWindow = makeMainWindow();
    manager.setMainWindow(mainWindow as never);
    manager.createTab("tab-1", "environment-a");

    const partition = manager.getBrowserPartition("environment-a");
    const browserSession = sessions.get(partition)!;

    const wrongType = makeGuest({
      mainWebContents: mainWindow.webContents,
      browserSession,
      type: "window",
    }).guest;
    fromId.mockReturnValueOnce(wrongType);
    expect(() => manager.registerWebview("tab-1", wrongType.id)).toThrow();

    const wrongHost = makeGuest({
      mainWebContents: {},
      browserSession,
    }).guest;
    fromId.mockReturnValueOnce(wrongHost);
    expect(() => manager.registerWebview("tab-1", wrongHost.id)).toThrow();

    const wrongPartition = makeGuest({
      mainWebContents: mainWindow.webContents,
      browserSession: makeBrowserSession(),
    }).guest;
    fromId.mockReturnValueOnce(wrongPartition);
    expect(() => manager.registerWebview("tab-1", wrongPartition.id)).toThrow();

    const valid = makeGuest({
      mainWebContents: mainWindow.webContents,
      browserSession,
    }).guest;
    fromId.mockReturnValueOnce(valid);
    expect(() => manager.registerWebview("tab-1", valid.id)).not.toThrow();
  });

  it("accepts preview IPC only from the current main renderer", () => {
    const manager = new PreviewViewManager();
    const mainWindow = makeMainWindow();
    manager.setMainWindow(mainWindow as never);

    expect(manager.isTrustedSender(mainWindow.webContents)).toBe(true);
    expect(manager.isTrustedSender({})).toBe(false);
    manager.clearMainWindow(mainWindow as never);
    expect(manager.isTrustedSender(mainWindow.webContents)).toBe(false);
  });

  it("isolates failed state listeners", () => {
    const manager = new PreviewViewManager();
    const delivered = vi.fn();
    manager.onStateChange(() => {
      throw new Error("renderer unavailable");
    });
    manager.onStateChange(delivered);

    expect(() => manager.createTab("tab-listener", "environment-a")).not.toThrow();
    expect(delivered).toHaveBeenCalledOnce();
    expect(delivered.mock.calls[0]?.[0]).toBe("tab-listener");
  });
});
