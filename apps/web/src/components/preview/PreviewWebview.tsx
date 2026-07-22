"use client";

import type { ScopedSessionRef } from "@t3tools/contracts";
import { useEffect, useRef } from "react";

import { readPreviewBridge } from "./previewBridge";
import { usePreviewBridge } from "./usePreviewBridge";

interface ElectronWebview extends HTMLElement {
  src: string;
  partition: string;
  getWebContentsId: () => number;
}

declare global {
  interface HTMLElementTagNameMap {
    webview: ElectronWebview;
  }
}

// React's Electron typings model this as boolean, while React requires a
// string for unknown custom-element attributes in browser tests.
const ALLOW_POPUPS_ATTRIBUTE = { allowpopups: "true" } as unknown as {
  readonly allowpopups: boolean;
};

export function PreviewWebview(props: {
  sessionRef: ScopedSessionRef;
  tabId: string;
  initialUrl: string | null;
  className?: string;
}) {
  const webviewRef = useRef<ElectronWebview | null>(null);
  const initialUrlRef = useRef(props.initialUrl);
  const bridge = readPreviewBridge();
  const partition = usePreviewBridge({ sessionRef: props.sessionRef, tabId: props.tabId });

  useEffect(() => {
    if (!bridge || !partition) return;
    const webview = webviewRef.current;
    if (!webview) return;
    let cancelled = false;
    let registrationInFlight = false;
    let initialized = false;
    const initialize = () => {
      if (cancelled || registrationInFlight || initialized) return;
      let id: number;
      try {
        id = webview.getWebContentsId();
      } catch {
        // A subsequent dom-ready retries registration.
        return;
      }
      if (!Number.isInteger(id) || id <= 0) return;

      registrationInFlight = true;
      void (async () => {
        await bridge.registerWebview(props.tabId, id);
        if (cancelled) return;
        initialized = true;
        if (initialUrlRef.current) {
          await bridge.navigate(props.tabId, initialUrlRef.current);
        }
      })().catch(() => {
        if (!cancelled && !initialized) registrationInFlight = false;
      });
    };
    webview.addEventListener("dom-ready", initialize);
    initialize();
    return () => {
      cancelled = true;
      webview.removeEventListener("dom-ready", initialize);
    };
  }, [bridge, partition, props.tabId]);

  if (!bridge || !partition) return null;
  return (
    <webview
      ref={webviewRef}
      src="about:blank"
      partition={partition}
      {...ALLOW_POPUPS_ATTRIBUTE}
      data-preview-tab={props.tabId}
      className={props.className}
    />
  );
}
