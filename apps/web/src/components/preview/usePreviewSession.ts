"use client";

import { scopedSessionKey } from "@t3tools/client-runtime";
import type { ScopedSessionRef } from "@t3tools/contracts";
import { useEffect } from "react";

import { ensureEnvironmentApi } from "~/environmentApi";
import { readPreviewStateRevision, usePreviewStateStore } from "~/previewStateStore";

/** Subscribe to preview events and hydrate/recover state after reconnects. */
export function usePreviewSession(sessionRef: ScopedSessionRef): void {
  const applyServerEvent = usePreviewStateStore((state) => state.applyServerEvent);
  const replaceServerSnapshots = usePreviewStateStore((state) => state.replaceServerSnapshots);

  useEffect(() => {
    const api = ensureEnvironmentApi(sessionRef.environmentId);
    let cancelled = false;
    let hydrationGeneration = 0;

    const hydrate = async () => {
      const generation = ++hydrationGeneration;
      const revision = readPreviewStateRevision(sessionRef);
      const localState =
        usePreviewStateStore.getState().bySessionKey[scopedSessionKey(sessionRef)] ?? null;
      const localSnapshot = localState?.snapshot ?? null;
      const managedResearch = localState?.managedResearch ?? null;
      const managedResearchRevision = localState?.managedResearchRevision ?? 0;
      const staleTabIds = new Set(Object.keys(localState?.sessions ?? {}));
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
          managedResearch?.url ??
          (localSnapshot && localSnapshot.navStatus._tag !== "Idle"
            ? localSnapshot.navStatus.url
            : null);
        if (!recoverableUrl) {
          replaceServerSnapshots(sessionRef, []);
          return;
        }
        const recovered = await api.preview.open({
          sessionId: sessionRef.sessionId,
          url: recoverableUrl,
        });
        if (cancelled || generation !== hydrationGeneration) return;
        const current =
          usePreviewStateStore.getState().bySessionKey[scopedSessionKey(sessionRef)] ?? null;
        const concurrentSnapshots = Object.values(current?.sessions ?? {}).filter(
          (snapshot) => !staleTabIds.has(snapshot.tabId),
        );
        const shouldRestoreManagedResearch =
          managedResearch !== null &&
          (current?.managedResearchRevision ?? 0) === managedResearchRevision;
        replaceServerSnapshots(sessionRef, [...concurrentSnapshots, recovered]);
        const reconciled =
          usePreviewStateStore.getState().bySessionKey[scopedSessionKey(sessionRef)] ?? null;
        if (shouldRestoreManagedResearch && reconciled?.managedResearch === null) {
          usePreviewStateStore.getState().markManagedResearch(sessionRef, {
            ...managedResearch,
            tabId: recovered.tabId,
            url: recoverableUrl,
          });
        }
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
  }, [applyServerEvent, replaceServerSnapshots, sessionRef]);
}
