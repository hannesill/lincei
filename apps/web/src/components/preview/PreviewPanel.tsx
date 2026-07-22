"use client";

import type { ScopedSessionRef } from "@t3tools/contracts";

import { isPreviewSupportedInRuntime } from "~/previewStateStore";

import { PreviewView } from "./PreviewView";

export function PreviewPanel(props: {
  mode: "sidebar" | "sheet";
  sessionRef: ScopedSessionRef;
  configuredUrls?: ReadonlyArray<string> | undefined;
  onClosePanel: () => void;
}) {
  return (
    <div
      className="flex h-full min-h-0 w-full flex-col bg-background"
      data-preview-panel-mode={props.mode}
    >
      {isPreviewSupportedInRuntime() ? (
        <PreviewView
          sessionRef={props.sessionRef}
          configuredUrls={props.configuredUrls}
          onClosePanel={props.onClosePanel}
        />
      ) : (
        <div className="flex min-h-0 flex-1 items-center justify-center p-8 text-center text-sm text-muted-foreground">
          Embedded preview is available in the Lincei desktop app. Links open in your system browser
          on the web.
        </div>
      )}
    </div>
  );
}
