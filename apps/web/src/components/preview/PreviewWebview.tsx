"use client";

import type { ScopedSessionRef } from "@t3tools/contracts";
import { useEffect, useRef } from "react";

import { isElectron } from "~/env";

import { previewBridge } from "./previewBridge";
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

export function PreviewWebview(props: {
  sessionRef: ScopedSessionRef;
  tabId: string;
  initialUrl: string | null;
  className?: string;
}) {
  const webviewRef = useRef<ElectronWebview | null>(null);
  const initialSrcRef = useRef(props.initialUrl ?? "about:blank");
  const bridge = previewBridge;
  const partition = usePreviewBridge({ sessionRef: props.sessionRef, tabId: props.tabId });

  useEffect(() => {
    if (!bridge || !partition) return;
    const webview = webviewRef.current;
    if (!webview) return;
    const register = () => {
      try {
        const id = webview.getWebContentsId();
        if (Number.isInteger(id) && id > 0) {
          void bridge.registerWebview(props.tabId, id).catch(() => undefined);
        }
      } catch {
        // A subsequent dom-ready retries registration.
      }
    };
    webview.addEventListener("dom-ready", register);
    register();
    return () => webview.removeEventListener("dom-ready", register);
  }, [bridge, partition, props.tabId]);

  if (!isElectron || !bridge || !partition) return null;
  return (
    <webview
      ref={webviewRef}
      src={initialSrcRef.current}
      partition={partition}
      allowpopups
      data-preview-tab={props.tabId}
      className={props.className}
    />
  );
}
