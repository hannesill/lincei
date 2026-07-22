"use client";

import type {
  DesktopPreviewTabState,
  PreviewReportStatusInput,
  ScopedSessionRef,
} from "@t3tools/contracts";
import { useEffect, useRef, useState } from "react";

import { ensureEnvironmentApi } from "~/environmentApi";
import { type DesktopPreviewOverlay, usePreviewStateStore } from "~/previewStateStore";

import { previewBridge } from "./previewBridge";

/** Own the desktop tab lifecycle and reflect WebContents state to the server. */
export function usePreviewBridge(input: {
  sessionRef: ScopedSessionRef;
  tabId: string;
}): string | null {
  const { sessionRef, tabId } = input;
  const [partition, setPartition] = useState<string | null>(null);
  const applyDesktopState = usePreviewStateStore((state) => state.applyDesktopState);
  const bridge = previewBridge;

  useEffect(() => {
    if (!bridge) return;
    let cancelled = false;
    void (async () => {
      await bridge.createTab(tabId, sessionRef.environmentId);
      const nextPartition = await bridge.getBrowserPartition(sessionRef.environmentId);
      if (!cancelled) setPartition(nextPartition);
    })().catch(() => {
      if (!cancelled) setPartition(null);
    });
    return () => {
      cancelled = true;
      setPartition(null);
      applyDesktopState(sessionRef, tabId, null);
      void bridge.closeTab(tabId).catch(() => undefined);
    };
  }, [applyDesktopState, bridge, sessionRef, tabId]);

  const lastReportedUrl = useRef<string | null>(null);
  const lastReportedKind = useRef<DesktopPreviewTabState["navStatus"]["kind"] | null>(null);
  useEffect(() => {
    if (!bridge) return;
    const api = ensureEnvironmentApi(sessionRef.environmentId);
    lastReportedUrl.current = null;
    lastReportedKind.current = null;
    return bridge.onStateChange((changedTabId, state) => {
      if (changedTabId !== tabId) return;
      applyDesktopState(sessionRef, tabId, projectDesktopState(state));
      const reported = buildReportInput({
        sessionRef,
        tabId,
        state,
        lastReportedUrl: lastReportedUrl.current,
        lastReportedKind: lastReportedKind.current,
      });
      if (!reported) return;
      lastReportedUrl.current = reported.lastReportedUrl;
      lastReportedKind.current = reported.lastReportedKind;
      void api.preview.reportStatus(reported.input).catch(() => undefined);
    });
  }, [applyDesktopState, bridge, sessionRef, tabId]);

  return partition;
}

function projectDesktopState(state: DesktopPreviewTabState): DesktopPreviewOverlay {
  return {
    canGoBack: state.canGoBack,
    canGoForward: state.canGoForward,
    loading: state.navStatus.kind === "Loading",
    zoomFactor: state.zoomFactor,
  };
}

export function buildReportInput(args: {
  readonly sessionRef: ScopedSessionRef;
  readonly tabId: string;
  readonly state: DesktopPreviewTabState;
  readonly lastReportedUrl: string | null;
  readonly lastReportedKind: DesktopPreviewTabState["navStatus"]["kind"] | null;
}): {
  readonly input: PreviewReportStatusInput;
  readonly lastReportedUrl: string;
  readonly lastReportedKind: DesktopPreviewTabState["navStatus"]["kind"];
} | null {
  const { sessionRef, tabId, state, lastReportedUrl, lastReportedKind } = args;
  const status = state.navStatus;
  if (status.kind === "Idle") return null;
  if (
    status.kind !== "LoadFailed" &&
    status.kind === lastReportedKind &&
    status.url === lastReportedUrl
  ) {
    return null;
  }
  const navStatus: PreviewReportStatusInput["navStatus"] =
    status.kind === "LoadFailed"
      ? {
          _tag: "LoadFailed",
          url: status.url,
          title: status.title,
          code: status.code,
          description: status.description,
        }
      : { _tag: status.kind, url: status.url, title: status.title };
  return {
    input: {
      sessionId: sessionRef.sessionId,
      tabId,
      canGoBack: state.canGoBack,
      canGoForward: state.canGoForward,
      navStatus,
    },
    lastReportedUrl: status.url,
    lastReportedKind: status.kind,
  };
}
