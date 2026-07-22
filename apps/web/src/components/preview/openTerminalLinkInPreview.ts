import type { EnvironmentApi, LocalApi, ScopedSessionRef } from "@t3tools/contracts";
import { isPreviewableUrl } from "@t3tools/shared/preview";

import { isPreviewSupportedInRuntime } from "~/previewStateStore";

import { openPreviewSession } from "./openPreviewSession";
import { dispatchPreviewAction } from "./previewActionBus";

export async function openTerminalLinkInPreview(input: {
  url: string;
  position: { x: number; y: number };
  sessionRef: ScopedSessionRef;
  api: EnvironmentApi;
  localApi: LocalApi;
  fallbackToBrowser: () => Promise<void>;
}): Promise<void> {
  if (!isPreviewableUrl(input.url) || !isPreviewSupportedInRuntime()) {
    await input.fallbackToBrowser();
    return;
  }

  let choice: "open-in-preview" | "open-in-browser" | null;
  try {
    choice = await input.localApi.contextMenu.show(
      [
        { id: "open-in-preview", label: "Open in preview" },
        { id: "open-in-browser", label: "Open in browser" },
      ],
      input.position,
    );
  } catch {
    await input.fallbackToBrowser();
    return;
  }
  if (choice === "open-in-browser") {
    await input.fallbackToBrowser();
    return;
  }
  if (choice !== "open-in-preview") return;

  try {
    await openPreviewSession({
      previewApi: input.api.preview,
      sessionRef: input.sessionRef,
      url: input.url,
    });
    dispatchPreviewAction("open-panel");
  } catch {
    await input.fallbackToBrowser();
  }
}
