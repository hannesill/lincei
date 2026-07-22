"use client";

export type PreviewAction = "open-panel" | "toggle-panel";

const EVENT_NAME = "lincei:preview-action";

export function dispatchPreviewAction(action: PreviewAction): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<PreviewAction>(EVENT_NAME, { detail: action }));
}

export function subscribePreviewAction(listener: (action: PreviewAction) => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const handler = (event: Event) => {
    const action = (event as CustomEvent<PreviewAction>).detail;
    if (action === "open-panel" || action === "toggle-panel") listener(action);
  };
  window.addEventListener(EVENT_NAME, handler);
  return () => window.removeEventListener(EVENT_NAME, handler);
}
