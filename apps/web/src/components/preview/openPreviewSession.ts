import { scopedSessionKey } from "@t3tools/client-runtime";
import type { EnvironmentApi, PreviewSessionSnapshot, ScopedSessionRef } from "@t3tools/contracts";
import { normalizePreviewUrl } from "@t3tools/shared/preview";

import { usePreviewStateStore } from "~/previewStateStore";

export function findPreviewSessionByUrl(
  sessionRef: ScopedSessionRef,
  rawUrl: string,
): PreviewSessionSnapshot | null {
  const normalizedUrl = normalizePreviewUrl(rawUrl);
  const state = usePreviewStateStore.getState().bySessionKey[scopedSessionKey(sessionRef)];
  if (!state) return null;
  return (
    Object.values(state.sessions).find((snapshot) => {
      if (snapshot.navStatus._tag === "Idle") return false;
      try {
        return normalizePreviewUrl(snapshot.navStatus.url) === normalizedUrl;
      } catch {
        return false;
      }
    }) ?? null
  );
}

/**
 * Focus an already-hydrated same-URL tab, otherwise create one and apply the
 * unary response immediately instead of waiting for the event stream.
 */
export async function openPreviewSession(input: {
  previewApi: Pick<EnvironmentApi["preview"], "open">;
  sessionRef: ScopedSessionRef;
  url: string;
}): Promise<PreviewSessionSnapshot> {
  const normalizedUrl = normalizePreviewUrl(input.url);
  const existing = findPreviewSessionByUrl(input.sessionRef, normalizedUrl);
  const store = usePreviewStateStore.getState();
  if (existing) {
    store.setActiveTab(input.sessionRef, existing.tabId);
    store.rememberUrl(input.sessionRef, normalizedUrl);
    return existing;
  }

  const snapshot = await input.previewApi.open({
    sessionId: input.sessionRef.sessionId,
    url: normalizedUrl,
  });
  store.applyServerSnapshot(input.sessionRef, snapshot);
  store.rememberUrl(
    input.sessionRef,
    snapshot.navStatus._tag === "Idle" ? normalizedUrl : snapshot.navStatus.url,
  );
  return snapshot;
}
