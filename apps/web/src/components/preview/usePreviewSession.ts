"use client";

import { scopedSessionKey } from "@t3tools/client-runtime";
import type { ScopedSessionRef } from "@t3tools/contracts";
import { useEffect } from "react";

import { ensureEnvironmentApi } from "~/environmentApi";
import { readPreviewStateRevision, usePreviewStateStore } from "~/previewStateStore";

/** Subscribe to preview events and hydrate/recover state after reconnects. */
export function usePreviewSession(sessionRef: ScopedSessionRef): void {
  const applyServerEvent = usePreviewStateStore((state) => state.applyServerEvent);
  const applyServerSnapshot = usePreviewStateStore((state) => state.applyServerSnapshot);
  const replaceServerSnapshots = usePreviewStateStore((state) => state.replaceServerSnapshots);

  useEffect(() => {
    const api = ensureEnvironmentApi(sessionRef.environmentId);
    let cancelled = false;
    let hydrationGeneration = 0;

    const hydrate = async () => {
      const generation = ++hydrationGeneration;
      const revision = readPreviewStateRevision(sessionRef);
      const localSnapshot =
        usePreviewStateStore.getState().bySessionKey[scopedSessionKey(sessionRef)]?.snapshot ??
        null;
      try {
        const result = await api.preview.list({ sessionId: sessionRef.sessionId });
        if (
          cancelled ||
          generation !== hydrationGeneration ||
          revision !== readPreviewStateRevision(sessionRef)
        ) {
          return;
        }
        if (result.sessions.length > 0) {
          replaceServerSnapshots(sessionRef, result.sessions);
          return;
        }
        const recoverableUrl =
          localSnapshot && localSnapshot.navStatus._tag !== "Idle"
            ? localSnapshot.navStatus.url
            : null;
        if (!recoverableUrl) {
          replaceServerSnapshots(sessionRef, []);
          return;
        }
        const recovered = await api.preview.open({
          sessionId: sessionRef.sessionId,
          url: recoverableUrl,
        });
        if (cancelled || generation !== hydrationGeneration) return;
        applyServerSnapshot(sessionRef, recovered);
      } catch {
        // Preserve the last usable renderer snapshot while disconnected.
      }
    };

    const unsubscribe = api.preview.onEvent(
      (event) => {
        if (event.sessionId !== sessionRef.sessionId) return;
        applyServerEvent(sessionRef, event);
      },
      { onResubscribe: () => void hydrate() },
    );
    void hydrate();

    return () => {
      cancelled = true;
      hydrationGeneration += 1;
      unsubscribe();
    };
  }, [applyServerEvent, applyServerSnapshot, replaceServerSnapshots, sessionRef]);
}
