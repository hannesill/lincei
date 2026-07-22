"use client";

import { scopedSessionKey } from "@t3tools/client-runtime";
import type { ScopedSessionRef } from "@t3tools/contracts";
import { normalizePreviewUrl } from "@t3tools/shared/preview";
import { useCallback } from "react";

import { ensureEnvironmentApi } from "~/environmentApi";
import { readLocalApi } from "~/localApi";
import { selectSessionPreviewState, usePreviewStateStore } from "~/previewStateStore";

import { openPreviewSession } from "./openPreviewSession";
import { previewBridge } from "./previewBridge";
import { PreviewChromeRow } from "./PreviewChromeRow";
import { PreviewEmptyState } from "./PreviewEmptyState";
import { PreviewMoreMenu } from "./PreviewMoreMenu";
import { PreviewUnreachable } from "./PreviewUnreachable";
import { PreviewWebview } from "./PreviewWebview";
import { useLoadingProgress } from "./useLoadingProgress";
import { usePreviewSession } from "./usePreviewSession";
import { ZoomIndicator } from "./ZoomIndicator";

export function PreviewView(props: {
  sessionRef: ScopedSessionRef;
  configuredUrls?: ReadonlyArray<string> | undefined;
  onClosePanel: () => void;
}) {
  const { configuredUrls, onClosePanel, sessionRef } = props;
  const previewState = usePreviewStateStore((state) =>
    selectSessionPreviewState(state.bySessionKey, sessionRef),
  );
  const rememberUrl = usePreviewStateStore((state) => state.rememberUrl);
  const removeSession = usePreviewStateStore((state) => state.removeSession);
  usePreviewSession(sessionRef);

  const { snapshot, desktopOverlay } = previewState;
  const tabId = snapshot?.tabId ?? null;
  const navStatus = snapshot?.navStatus ?? { _tag: "Idle" as const };
  const url = navStatus._tag === "Idle" ? "" : navStatus.url;
  const loading = desktopOverlay?.loading ?? navStatus._tag === "Loading";
  const loadProgress = useLoadingProgress(loading);

  const handleSubmitUrl = useCallback(
    async (rawUrl: string) => {
      const api = ensureEnvironmentApi(sessionRef.environmentId);
      try {
        const nextUrl = normalizePreviewUrl(rawUrl);
        if (tabId && previewBridge) {
          await previewBridge.navigate(tabId, nextUrl);
          rememberUrl(sessionRef, nextUrl);
          return;
        }
        await openPreviewSession({
          previewApi: api.preview,
          sessionRef,
          url: nextUrl,
        });
      } catch {
        // Chromium load failures are projected through the desktop state stream.
      }
    },
    [rememberUrl, sessionRef, tabId],
  );
  const handleRefresh = useCallback(() => {
    if (!tabId || !previewBridge) return;
    const api = ensureEnvironmentApi(sessionRef.environmentId);
    const bridge = previewBridge;
    void api.preview
      .refresh({ sessionId: sessionRef.sessionId, tabId })
      .then(() => bridge.refresh(tabId))
      .catch(() => undefined);
  }, [sessionRef, tabId]);
  const handleCloseTab = useCallback(() => {
    if (!tabId) return;
    const api = ensureEnvironmentApi(sessionRef.environmentId);
    void api.preview
      .close({ sessionId: sessionRef.sessionId, tabId })
      .then(() => {
        removeSession(sessionRef, tabId);
        const state = usePreviewStateStore.getState().bySessionKey[scopedSessionKey(sessionRef)];
        if (!state || Object.keys(state.sessions).length === 0) onClosePanel();
      })
      .catch(() => undefined);
  }, [onClosePanel, removeSession, sessionRef, tabId]);
  const handleOpenInBrowser = useCallback(() => {
    const localApi = readLocalApi();
    if (!localApi || !url) return;
    void localApi.shell.openExternal(url).catch(() => undefined);
  }, [url]);

  const isUnreachable = navStatus._tag === "LoadFailed";
  return (
    <div
      className="flex h-full min-h-0 flex-1 flex-col bg-background"
      data-session-key={scopedSessionKey(sessionRef)}
    >
      <PreviewChromeRow
        url={url}
        loading={loading}
        loadProgress={loadProgress}
        canGoBack={desktopOverlay?.canGoBack ?? snapshot?.canGoBack ?? false}
        canGoForward={desktopOverlay?.canGoForward ?? snapshot?.canGoForward ?? false}
        refreshDisabled={navStatus._tag === "Idle"}
        onBack={() => {
          if (tabId && previewBridge) void previewBridge.goBack(tabId).catch(() => undefined);
        }}
        onForward={() => {
          if (tabId && previewBridge) void previewBridge.goForward(tabId).catch(() => undefined);
        }}
        onRefresh={handleRefresh}
        onSubmit={(next) => void handleSubmitUrl(next)}
        onOpenInBrowser={tabId ? handleOpenInBrowser : undefined}
        trailingActions={
          previewBridge ? (
            <PreviewMoreMenu
              tabId={tabId}
              scope={sessionRef.environmentId}
              hasWebContents={desktopOverlay !== null}
              zoomFactor={desktopOverlay?.zoomFactor ?? 1}
              onCloseTab={handleCloseTab}
            />
          ) : null
        }
      />
      <div className="relative min-h-0 flex-1 overflow-hidden">
        {tabId && snapshot ? (
          <PreviewWebview
            key={tabId}
            sessionRef={sessionRef}
            tabId={tabId}
            initialUrl={url || null}
            className="absolute inset-0 h-full w-full"
          />
        ) : (
          <PreviewEmptyState
            environmentId={sessionRef.environmentId}
            configuredUrls={configuredUrls}
            recentlySeenUrls={previewState.recentlySeenUrls}
            onOpenUrl={(next) => void handleSubmitUrl(next)}
          />
        )}
        {snapshot && desktopOverlay ? (
          <ZoomIndicator zoomFactor={desktopOverlay.zoomFactor} />
        ) : null}
        {isUnreachable && navStatus._tag === "LoadFailed" ? (
          <div className="absolute inset-0 z-10 bg-background">
            <PreviewUnreachable
              url={navStatus.url}
              code={navStatus.code}
              description={navStatus.description}
              onReload={handleRefresh}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
