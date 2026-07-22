/**
 * Per-session embedded-browser state.
 *
 * Server snapshots survive WebSocket reconnects. Desktop overlays carry
 * low-latency WebContents state that is never sent through the route layer.
 */
import { scopedSessionKey } from "@t3tools/client-runtime";
import type { PreviewEvent, PreviewSessionSnapshot, ScopedSessionRef } from "@t3tools/contracts";
import { create } from "zustand";

import { PREVIEW_RECENT_URL_LIMIT } from "./components/preview/previewConstants";

export interface DesktopPreviewOverlay {
  canGoBack: boolean;
  canGoForward: boolean;
  loading: boolean;
  zoomFactor: number;
}

export interface SessionPreviewState {
  snapshot: PreviewSessionSnapshot | null;
  sessions: Record<string, PreviewSessionSnapshot>;
  activeTabId: string | null;
  desktopOverlay: DesktopPreviewOverlay | null;
  desktopByTabId: Record<string, DesktopPreviewOverlay>;
  recentlySeenUrls: string[];
}

const EMPTY_SESSION_PREVIEW_STATE: SessionPreviewState = Object.freeze({
  snapshot: null,
  sessions: {},
  activeTabId: null,
  desktopOverlay: null,
  desktopByTabId: {},
  recentlySeenUrls: [] as string[],
});

const revisionBySessionKey = new Map<string, number>();

const bumpPreviewStateRevision = (sessionKey: string): void => {
  revisionBySessionKey.set(sessionKey, (revisionBySessionKey.get(sessionKey) ?? 0) + 1);
};

export function readPreviewStateRevision(ref: ScopedSessionRef): number {
  return revisionBySessionKey.get(scopedSessionKey(ref)) ?? 0;
}

export interface PreviewStateStoreState {
  bySessionKey: Record<string, SessionPreviewState>;
  applyServerEvent: (ref: ScopedSessionRef, event: PreviewEvent) => void;
  applyServerSnapshot: (ref: ScopedSessionRef, snapshot: PreviewSessionSnapshot) => void;
  replaceServerSnapshots: (
    ref: ScopedSessionRef,
    snapshots: ReadonlyArray<PreviewSessionSnapshot>,
  ) => void;
  applyDesktopState: (
    ref: ScopedSessionRef,
    tabId: string,
    overlay: DesktopPreviewOverlay | null,
  ) => void;
  removeSession: (ref: ScopedSessionRef, tabId: string) => void;
  setActiveTab: (ref: ScopedSessionRef, tabId: string) => void;
  rememberUrl: (ref: ScopedSessionRef, url: string) => void;
  removeSessionState: (ref: ScopedSessionRef) => void;
}

const ensureState = (
  bySessionKey: Record<string, SessionPreviewState>,
  sessionKey: string,
): SessionPreviewState => bySessionKey[sessionKey] ?? EMPTY_SESSION_PREVIEW_STATE;

const updateSession = (
  state: PreviewStateStoreState,
  sessionKey: string,
  updater: (current: SessionPreviewState) => SessionPreviewState,
): PreviewStateStoreState["bySessionKey"] => {
  const current = ensureState(state.bySessionKey, sessionKey);
  const next = updater(current);
  if (next === current) return state.bySessionKey;
  return { ...state.bySessionKey, [sessionKey]: next };
};

const dedupeRecentUrls = (existing: string[], url: string): string[] => {
  const next = [url, ...existing.filter((entry) => entry !== url)];
  return next.slice(0, PREVIEW_RECENT_URL_LIMIT);
};

const rememberSnapshotUrl = (existing: string[], snapshot: PreviewSessionSnapshot): string[] =>
  snapshot.navStatus._tag === "Idle"
    ? existing
    : dedupeRecentUrls(existing, snapshot.navStatus.url);

const freshestSnapshot = (
  sessions: Record<string, PreviewSessionSnapshot>,
): PreviewSessionSnapshot | null =>
  Object.values(sessions)
    .toSorted((left, right) => left.updatedAt.localeCompare(right.updatedAt))
    .at(-1) ?? null;

const removePreviewSession = (current: SessionPreviewState, tabId: string): SessionPreviewState => {
  if (!current.sessions[tabId]) return current;
  const { [tabId]: _closed, ...sessions } = current.sessions;
  const { [tabId]: _desktop, ...desktopByTabId } = current.desktopByTabId;
  const fallback = freshestSnapshot(sessions);
  const activeTabId = current.activeTabId === tabId ? fallback?.tabId : current.activeTabId;
  const snapshot = activeTabId ? (sessions[activeTabId] ?? fallback) : fallback;
  return {
    ...current,
    sessions,
    desktopByTabId,
    activeTabId: snapshot?.tabId ?? null,
    snapshot,
    desktopOverlay: snapshot ? (desktopByTabId[snapshot.tabId] ?? null) : null,
  };
};

export const usePreviewStateStore = create<PreviewStateStoreState>()((set) => ({
  bySessionKey: {},
  applyServerEvent: (ref, event) =>
    set((state) => {
      const sessionKey = scopedSessionKey(ref);
      bumpPreviewStateRevision(sessionKey);
      const bySessionKey = updateSession(state, sessionKey, (current) => {
        switch (event.type) {
          case "opened":
          case "navigated": {
            const snapshot = event.snapshot;
            const existing = current.sessions[snapshot.tabId];
            if (existing && existing.updatedAt > snapshot.updatedAt) return current;
            const sessions = { ...current.sessions, [snapshot.tabId]: snapshot };
            const activeTabId =
              event.type === "opened" ? snapshot.tabId : (current.activeTabId ?? snapshot.tabId);
            const activeSnapshot = sessions[activeTabId] ?? snapshot;
            return {
              ...current,
              sessions,
              activeTabId,
              snapshot: activeSnapshot,
              desktopOverlay: current.desktopByTabId[activeSnapshot.tabId] ?? null,
              recentlySeenUrls: rememberSnapshotUrl(current.recentlySeenUrls, snapshot),
            };
          }
          case "failed": {
            const existing = current.sessions[event.tabId];
            if (!existing || existing.updatedAt > event.createdAt) return current;
            const failedSnapshot: PreviewSessionSnapshot = {
              ...existing,
              navStatus: {
                _tag: "LoadFailed",
                url: event.url,
                title: event.title,
                code: event.code,
                description: event.description,
              },
              updatedAt: event.createdAt,
            };
            const sessions = { ...current.sessions, [event.tabId]: failedSnapshot };
            return {
              ...current,
              sessions,
              snapshot: current.activeTabId === event.tabId ? failedSnapshot : current.snapshot,
              recentlySeenUrls: dedupeRecentUrls(current.recentlySeenUrls, event.url),
            };
          }
          case "closed":
            return removePreviewSession(current, event.tabId);
        }
      });
      return { bySessionKey };
    }),
  applyServerSnapshot: (ref, snapshot) =>
    set((state) => {
      const sessionKey = scopedSessionKey(ref);
      bumpPreviewStateRevision(sessionKey);
      return {
        bySessionKey: updateSession(state, sessionKey, (current) => {
          const existing = current.sessions[snapshot.tabId];
          if (existing && existing.updatedAt > snapshot.updatedAt) return current;
          return {
            ...current,
            sessions: { ...current.sessions, [snapshot.tabId]: snapshot },
            activeTabId: snapshot.tabId,
            snapshot,
            desktopOverlay: current.desktopByTabId[snapshot.tabId] ?? null,
            recentlySeenUrls: rememberSnapshotUrl(current.recentlySeenUrls, snapshot),
          };
        }),
      };
    }),
  replaceServerSnapshots: (ref, snapshots) =>
    set((state) => {
      const sessionKey = scopedSessionKey(ref);
      bumpPreviewStateRevision(sessionKey);
      return {
        bySessionKey: updateSession(state, sessionKey, (current) => {
          const sessions = Object.fromEntries(
            snapshots.map((snapshot) => [snapshot.tabId, snapshot]),
          );
          const fallback = freshestSnapshot(sessions);
          const activeTabId =
            current.activeTabId && sessions[current.activeTabId]
              ? current.activeTabId
              : (fallback?.tabId ?? null);
          const snapshot = activeTabId ? (sessions[activeTabId] ?? fallback) : fallback;
          const desktopByTabId = Object.fromEntries(
            Object.entries(current.desktopByTabId).filter(([tabId]) => tabId in sessions),
          );
          const recentlySeenUrls = snapshots.reduce(
            (urls, entry) => rememberSnapshotUrl(urls, entry),
            current.recentlySeenUrls,
          );
          return {
            ...current,
            sessions,
            activeTabId,
            snapshot,
            desktopByTabId,
            desktopOverlay: snapshot ? (desktopByTabId[snapshot.tabId] ?? null) : null,
            recentlySeenUrls,
          };
        }),
      };
    }),
  applyDesktopState: (ref, tabId, overlay) =>
    set((state) => {
      const sessionKey = scopedSessionKey(ref);
      return {
        bySessionKey: updateSession(state, sessionKey, (current) => {
          const desktopByTabId = { ...current.desktopByTabId };
          if (overlay) desktopByTabId[tabId] = overlay;
          else delete desktopByTabId[tabId];
          return {
            ...current,
            desktopByTabId,
            desktopOverlay: current.activeTabId === tabId ? overlay : current.desktopOverlay,
          };
        }),
      };
    }),
  removeSession: (ref, tabId) =>
    set((state) => {
      const sessionKey = scopedSessionKey(ref);
      bumpPreviewStateRevision(sessionKey);
      return {
        bySessionKey: updateSession(state, sessionKey, (current) =>
          removePreviewSession(current, tabId),
        ),
      };
    }),
  setActiveTab: (ref, tabId) =>
    set((state) => {
      const sessionKey = scopedSessionKey(ref);
      return {
        bySessionKey: updateSession(state, sessionKey, (current) => {
          const snapshot = current.sessions[tabId];
          if (!snapshot || current.activeTabId === tabId) return current;
          return {
            ...current,
            activeTabId: tabId,
            snapshot,
            desktopOverlay: current.desktopByTabId[tabId] ?? null,
          };
        }),
      };
    }),
  rememberUrl: (ref, url) =>
    set((state) => {
      const normalized = url.trim();
      if (normalized.length === 0) return state;
      const sessionKey = scopedSessionKey(ref);
      return {
        bySessionKey: updateSession(state, sessionKey, (current) => ({
          ...current,
          recentlySeenUrls: dedupeRecentUrls(current.recentlySeenUrls, normalized),
        })),
      };
    }),
  removeSessionState: (ref) =>
    set((state) => {
      const sessionKey = scopedSessionKey(ref);
      bumpPreviewStateRevision(sessionKey);
      if (!(sessionKey in state.bySessionKey)) return state;
      const { [sessionKey]: _removed, ...bySessionKey } = state.bySessionKey;
      return { bySessionKey };
    }),
}));

export function selectSessionPreviewState(
  bySessionKey: Record<string, SessionPreviewState>,
  ref: ScopedSessionRef | null | undefined,
): SessionPreviewState {
  if (!ref) return EMPTY_SESSION_PREVIEW_STATE;
  return ensureState(bySessionKey, scopedSessionKey(ref));
}

export function isPreviewSupportedInRuntime(): boolean {
  return typeof window !== "undefined" && Boolean(window.desktopBridge?.preview);
}

export const __testing = {
  EMPTY_SESSION_PREVIEW_STATE,
  RECENT_URL_LIMIT: PREVIEW_RECENT_URL_LIMIT,
  resetRevisions: () => revisionBySessionKey.clear(),
};
