/**
 * PreviewViewManager — desktop side of the in-app browser preview.
 *
 * Hosts per-tab Chromium WebContents references (the actual <webview>
 * elements live in the renderer; we only attach listeners and forward state
 * here). Browser sessions are partitioned by environment scope.
 */
import { createHash } from "node:crypto";

import type { DesktopPreviewNavStatus, DesktopPreviewTabState } from "@t3tools/contracts";
import { normalizePreviewUrl } from "@t3tools/shared/preview";
import { type BrowserWindow, type Session, session, webContents } from "electron";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";

const PREVIEW_PARTITION_PREFIX = "persist:lincei-preview-";
const ALLOWED_PREVIEW_PERMISSIONS: ReadonlySet<string> = new Set([
  "clipboard-read",
  "clipboard-sanitized-write",
]);

export type PreviewNavStatus = DesktopPreviewNavStatus;
export type PreviewTabState = DesktopPreviewTabState;

interface ManagedPreviewTabState extends PreviewTabState {
  readonly scope: string;
  readonly partition: string;
}

const currentIsoTimestamp = (): string =>
  Effect.runSync(DateTime.now.pipe(Effect.map(DateTime.formatIso)));

/** Discrete zoom levels mirroring Chrome's preset list. */
const ZOOM_LEVELS: ReadonlyArray<number> = [
  0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1.0, 1.1, 1.25, 1.5, 1.75, 2.0, 2.5, 3.0, 4.0, 5.0,
];

const DEFAULT_ZOOM_FACTOR = 1.0;
const ZOOM_EPSILON = 0.001;

const findZoomStep = (current: number): number => {
  for (let index = 0; index < ZOOM_LEVELS.length; index += 1) {
    if (Math.abs(ZOOM_LEVELS[index]! - current) < ZOOM_EPSILON) return index;
    if (ZOOM_LEVELS[index]! > current) return index - 1;
  }
  return ZOOM_LEVELS.length - 1;
};

const nextZoomLevel = (current: number, direction: "in" | "out"): number => {
  const step = findZoomStep(current);
  if (direction === "in") {
    return ZOOM_LEVELS[Math.min(step + 1, ZOOM_LEVELS.length - 1)] ?? current;
  }
  return ZOOM_LEVELS[Math.max(step - 1, 0)] ?? current;
};

type Listener = (tabId: string, state: PreviewTabState) => void;

interface ManagedListeners {
  navigate: () => void;
  failed: (event: Event, code: number, description: string) => void;
  beforeInput: (event: Electron.Event, input: Electron.Input) => void;
}

const APP_FORWARDED_SHORTCUTS: ReadonlyArray<{
  key: string;
  meta: boolean;
  shift: boolean;
  control: boolean;
}> = Object.freeze([
  // mod+shift+J → preview.toggle
  { key: "j", meta: true, shift: true, control: false },
  // mod+K → command palette
  { key: "k", meta: true, shift: false, control: false },
  // mod+, → settings (macOS convention)
  { key: ",", meta: true, shift: false, control: false },
  // mod+W → close tab/panel
  { key: "w", meta: true, shift: false, control: false },
]);

export class PreviewViewManager {
  private mainWindow: BrowserWindow | null = null;
  private readonly tabs = new Map<string, ManagedPreviewTabState>();
  private readonly attached = new Map<number, ManagedListeners>();
  private readonly browserSessions = new Map<string, Session>();
  private readonly listeners = new Set<Listener>();

  setMainWindow(window: BrowserWindow): void {
    this.mainWindow = window;
  }

  clearMainWindow(window: BrowserWindow): void {
    if (this.mainWindow === window) this.mainWindow = null;
  }

  isTrustedSender(sender: unknown): boolean {
    return (
      this.mainWindow !== null &&
      !this.mainWindow.isDestroyed() &&
      sender === this.mainWindow.webContents
    );
  }

  getMainWindow(): BrowserWindow | null {
    return this.mainWindow;
  }

  getBrowserPartition(scope: string): string {
    const normalizedScope = scope.trim();
    if (normalizedScope.length === 0 || normalizedScope.length > 512) {
      throw new PreviewScopeInvalidError();
    }
    const digest = createHash("sha256").update(normalizedScope).digest("hex").slice(0, 20);
    return `${PREVIEW_PARTITION_PREFIX}${digest}`;
  }

  isBrowserPartition(partition: string): boolean {
    return this.browserSessions.has(partition);
  }

  getBrowserSession(scope: string): Session {
    const partition = this.getBrowserPartition(scope);
    const existing = this.browserSessions.get(partition);
    if (existing) return existing;
    const sess = session.fromPartition(partition);
    const ua = sess
      .getUserAgent()
      .replace(/Electron\/[\d.]+ /, "")
      .replace(/\s*(?:t3code|lincei)\/[\w.-]+/gi, "");
    sess.setUserAgent(ua);
    sess.setPermissionRequestHandler((wc, permission, callback) => {
      callback(
        ALLOWED_PREVIEW_PERMISSIONS.has(permission) && this.isOwnedWebContents(wc, partition),
      );
    });
    sess.setPermissionCheckHandler((wc, permission) =>
      Boolean(
        ALLOWED_PREVIEW_PERMISSIONS.has(permission) && this.isOwnedWebContents(wc, partition),
      ),
    );
    this.browserSessions.set(partition, sess);
    return sess;
  }

  createTab(tabId: string, scope: string): PreviewTabState {
    const partition = this.getBrowserPartition(scope);
    const existing = this.tabs.get(tabId);
    if (existing) {
      if (existing.partition !== partition) throw new PreviewTabScopeMismatchError(tabId);
      return this.toPublicState(existing);
    }
    this.getBrowserSession(scope);
    const initial: ManagedPreviewTabState = {
      tabId,
      scope: scope.trim(),
      partition,
      webContentsId: null,
      navStatus: { kind: "Idle" },
      canGoBack: false,
      canGoForward: false,
      zoomFactor: DEFAULT_ZOOM_FACTOR,
      updatedAt: currentIsoTimestamp(),
    };
    this.tabs.set(tabId, initial);
    this.emit(tabId, initial);
    return this.toPublicState(initial);
  }

  closeTab(tabId: string): void {
    const tab = this.tabs.get(tabId);
    if (!tab) return;
    if (tab.webContentsId != null) {
      this.detachListeners(tab.webContentsId);
    }
    const closed: ManagedPreviewTabState = {
      ...tab,
      webContentsId: null,
      navStatus: { kind: "Idle" },
      canGoBack: false,
      canGoForward: false,
      zoomFactor: DEFAULT_ZOOM_FACTOR,
      updatedAt: currentIsoTimestamp(),
    };
    this.tabs.delete(tabId);
    this.emit(tabId, closed);
  }

  registerWebview(tabId: string, webContentsId: number): void {
    const tab = this.tabs.get(tabId);
    if (!tab) {
      throw new PreviewTabNotFoundError(tabId);
    }
    const wc = webContents.fromId(webContentsId);
    if (!wc) {
      throw new PreviewWebContentsNotFoundError(tabId, webContentsId);
    }
    // Defence in depth: the caller must not attach the main renderer, a guest
    // from another window, or a guest from another browser partition.
    if (!this.isOwnedWebContents(wc, tab.partition)) {
      throw new PreviewWebContentsNotFoundError(tabId, webContentsId);
    }
    if (tab.webContentsId === webContentsId && this.attached.has(webContentsId)) {
      return;
    }
    if (tab.webContentsId != null && tab.webContentsId !== webContentsId) {
      this.detachListeners(tab.webContentsId);
    }
    this.attachListeners(tabId, wc);
    // Restore the persisted zoom factor onto the freshly-attached WebContents
    // so a thread-switch + remount lands the user back where they were.
    if (Math.abs(tab.zoomFactor - DEFAULT_ZOOM_FACTOR) > ZOOM_EPSILON) {
      try {
        wc.setZoomFactor(tab.zoomFactor);
      } catch {
        // wc may have been torn down between resolution and call.
      }
    }
    this.update(tabId, {
      webContentsId,
      navStatus: this.computeNavStatus(wc),
      canGoBack: wc.navigationHistory.canGoBack(),
      canGoForward: wc.navigationHistory.canGoForward(),
      zoomFactor: tab.zoomFactor,
    });
  }

  async navigate(tabId: string, rawUrl: string): Promise<void> {
    const wc = this.requireWebContents(tabId);
    const url = this.normalizeUrl(rawUrl);
    if (wc.getURL() === url) {
      wc.reload();
      return;
    }
    await wc.loadURL(url);
  }

  goBack(tabId: string): void {
    const wc = this.requireWebContents(tabId);
    if (wc.navigationHistory.canGoBack()) {
      wc.navigationHistory.goBack();
    }
  }

  goForward(tabId: string): void {
    const wc = this.requireWebContents(tabId);
    if (wc.navigationHistory.canGoForward()) {
      wc.navigationHistory.goForward();
    }
  }

  refresh(tabId: string): void {
    const wc = this.requireWebContents(tabId);
    wc.reload();
  }

  /** Bypass HTTP cache on the next load — equivalent to Cmd+Shift+R. */
  hardReload(tabId: string): void {
    const wc = this.requireWebContents(tabId);
    wc.reloadIgnoringCache();
  }

  /**
   * Open the guest webview's DevTools, detached so it doesn't steal panel
   * area. Idempotent — re-invoking focuses the existing window.
   */
  openDevTools(tabId: string): void {
    const wc = this.requireWebContents(tabId);
    if (wc.isDevToolsOpened()) {
      wc.devToolsWebContents?.focus();
      return;
    }
    wc.openDevTools({ mode: "detach" });
  }

  /**
   * Drop cookies/localStorage/etc. for one environment-scoped partition.
   */
  async clearCookies(scope: string): Promise<void> {
    const sess = this.getBrowserSession(scope);
    await sess.clearStorageData({
      storages: ["cookies", "localstorage", "indexdb", "websql", "serviceworkers"],
    });
  }

  /** Drop the HTTP cache for the preview partition. */
  async clearCache(scope: string): Promise<void> {
    const sess = this.getBrowserSession(scope);
    await sess.clearCache();
  }

  zoomIn(tabId: string): void {
    this.applyZoom(tabId, (current) => nextZoomLevel(current, "in"));
  }

  zoomOut(tabId: string): void {
    this.applyZoom(tabId, (current) => nextZoomLevel(current, "out"));
  }

  resetZoom(tabId: string): void {
    this.applyZoom(tabId, () => DEFAULT_ZOOM_FACTOR);
  }

  private applyZoom(tabId: string, transform: (current: number) => number): void {
    const tab = this.tabs.get(tabId);
    if (!tab) return;
    const next = transform(tab.zoomFactor);
    if (Math.abs(next - tab.zoomFactor) < ZOOM_EPSILON) return;
    if (tab.webContentsId != null) {
      const wc = webContents.fromId(tab.webContentsId);
      if (wc && !wc.isDestroyed()) {
        wc.setZoomFactor(next);
      }
    }
    this.update(tabId, { zoomFactor: next });
  }

  onStateChange(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  destroy(): void {
    for (const tabId of Array.from(this.tabs.keys())) {
      this.closeTab(tabId);
    }
    this.listeners.clear();
  }

  private attachListeners(tabId: string, wc: Electron.WebContents): void {
    const sync = () => {
      if (wc.isDestroyed()) return;
      this.update(tabId, {
        navStatus: this.computeNavStatus(wc),
        canGoBack: wc.navigationHistory.canGoBack(),
        canGoForward: wc.navigationHistory.canGoForward(),
      });
    };
    const failed = (_event: Event, code: number, description: string): void => {
      // -3 = ABORTED (user navigated away mid-load); ignore.
      if (code === -3) return;
      this.update(tabId, {
        navStatus: {
          kind: "LoadFailed",
          url: wc.getURL(),
          title: wc.getTitle(),
          code,
          description,
        },
      });
    };

    wc.on("did-navigate", sync);
    wc.on("did-navigate-in-page", sync);
    wc.on("page-title-updated", sync);
    wc.on("did-start-loading", sync);
    wc.on("did-stop-loading", sync);
    wc.on("did-fail-load", failed as never);

    // Keep HTTP(S) popup targets inside the same guest and deny new windows.
    wc.setWindowOpenHandler(({ url }) => {
      try {
        void wc.loadURL(normalizePreviewUrl(url)).catch(() => undefined);
      } catch {
        // Unsupported protocols remain denied.
      }
      return { action: "deny" };
    });

    // Forward app-level shortcuts to the main window so mod+shift+J etc.
    // still toggles the preview panel even when the webview has focus.
    const beforeInput = (event: Electron.Event, input: Electron.Input): void => {
      if (this.isAppShortcut(input) && this.mainWindow && !this.mainWindow.isDestroyed()) {
        event.preventDefault();
        this.mainWindow.webContents.sendInputEvent({
          type: "keyDown",
          keyCode: input.key,
          modifiers: [
            ...(input.meta ? (["meta"] as const) : []),
            ...(input.shift ? (["shift"] as const) : []),
            ...(input.control ? (["control"] as const) : []),
            ...(input.alt ? (["alt"] as const) : []),
          ],
        });
      }
    };
    wc.on("before-input-event", beforeInput);

    this.attached.set(wc.id, { navigate: sync, failed, beforeInput });
  }

  private detachListeners(webContentsId: number): void {
    const handlers = this.attached.get(webContentsId);
    if (!handlers) return;
    this.attached.delete(webContentsId);
    const wc = webContents.fromId(webContentsId);
    if (!wc || wc.isDestroyed()) return;
    wc.off("did-navigate", handlers.navigate);
    wc.off("did-navigate-in-page", handlers.navigate);
    wc.off("page-title-updated", handlers.navigate);
    wc.off("did-start-loading", handlers.navigate);
    wc.off("did-stop-loading", handlers.navigate);
    wc.off("did-fail-load", handlers.failed as never);
    wc.off("before-input-event", handlers.beforeInput);
  }

  private isAppShortcut(input: Electron.Input): boolean {
    if (input.type !== "keyDown") return false;
    return APP_FORWARDED_SHORTCUTS.some(
      (shortcut) =>
        shortcut.key.toLowerCase() === input.key.toLowerCase() &&
        shortcut.meta === input.meta &&
        shortcut.shift === input.shift &&
        shortcut.control === input.control,
    );
  }

  private computeNavStatus(wc: Electron.WebContents): PreviewNavStatus {
    const url = wc.getURL();
    const title = wc.getTitle();
    if (url === "" || url === "about:blank") return { kind: "Idle" };
    if (wc.isLoading()) return { kind: "Loading", url, title };
    return { kind: "Success", url, title };
  }

  private requireWebContents(tabId: string): Electron.WebContents {
    const tab = this.tabs.get(tabId);
    if (!tab) throw new PreviewTabNotFoundError(tabId);
    if (tab.webContentsId == null) throw new PreviewWebviewNotInitializedError(tabId);
    const wc = webContents.fromId(tab.webContentsId);
    if (!wc || !this.isOwnedWebContents(wc, tab.partition)) {
      throw new PreviewWebContentsNotFoundError(tabId, tab.webContentsId);
    }
    return wc;
  }

  private update(tabId: string, patch: Partial<PreviewTabState>): void {
    const current = this.tabs.get(tabId);
    if (!current) return;
    const next: ManagedPreviewTabState = {
      ...current,
      ...patch,
      updatedAt: currentIsoTimestamp(),
    };
    this.tabs.set(tabId, next);
    this.emit(tabId, next);
  }

  private emit(tabId: string, state: PreviewTabState): void {
    const publicState = this.toPublicState(state as ManagedPreviewTabState);
    for (const listener of this.listeners) {
      try {
        listener(tabId, publicState);
      } catch {
        // listener errors must not crash the manager
      }
    }
  }

  private toPublicState(state: ManagedPreviewTabState): PreviewTabState {
    return {
      tabId: state.tabId,
      webContentsId: state.webContentsId,
      navStatus: state.navStatus,
      canGoBack: state.canGoBack,
      canGoForward: state.canGoForward,
      zoomFactor: state.zoomFactor,
      updatedAt: state.updatedAt,
    };
  }

  private isOwnedWebContents(
    wc: Electron.WebContents | null,
    expectedPartition: string,
  ): wc is Electron.WebContents {
    if (
      !wc ||
      wc.isDestroyed() ||
      wc.getType() !== "webview" ||
      this.mainWindow === null ||
      this.mainWindow.isDestroyed() ||
      wc.hostWebContents !== this.mainWindow.webContents
    ) {
      return false;
    }
    return this.browserSessions.get(expectedPartition) === wc.session;
  }

  private normalizeUrl(input: string): string {
    // Shared structured failures report only input length/reason.
    return normalizePreviewUrl(input);
  }
}

export class PreviewScopeInvalidError extends Error {
  constructor() {
    super("Preview browser scope must be a non-empty string of at most 512 characters");
    this.name = "PreviewScopeInvalidError";
  }
}

export class PreviewTabScopeMismatchError extends Error {
  readonly tabId: string;
  constructor(tabId: string) {
    super(`Preview tab belongs to a different browser scope: ${tabId}`);
    this.name = "PreviewTabScopeMismatchError";
    this.tabId = tabId;
  }
}

export class PreviewTabNotFoundError extends Error {
  readonly tabId: string;
  constructor(tabId: string) {
    super(`Preview tab not found: ${tabId}`);
    this.name = "PreviewTabNotFoundError";
    this.tabId = tabId;
  }
}

export class PreviewWebContentsNotFoundError extends Error {
  readonly tabId: string;
  readonly webContentsId: number;
  constructor(tabId: string, webContentsId: number) {
    super(`WebContents ${webContentsId} not found for preview tab ${tabId}`);
    this.name = "PreviewWebContentsNotFoundError";
    this.tabId = tabId;
    this.webContentsId = webContentsId;
  }
}

export class PreviewWebviewNotInitializedError extends Error {
  readonly tabId: string;
  constructor(tabId: string) {
    super(`Preview tab "${tabId}" has no webview registered`);
    this.name = "PreviewWebviewNotInitializedError";
    this.tabId = tabId;
  }
}

export const previewViewManager = new PreviewViewManager();
