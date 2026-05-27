import { parseScopedSessionKey, scopeProjectRef, scopeSessionRef } from "@t3tools/client-runtime";
import { type ScopedSessionRef, SessionId } from "@t3tools/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { useCallback, useRef } from "react";

import { getFallbackSessionIdAfterDelete } from "../components/Sidebar.logic";
import { useComposerDraftStore } from "../composerDraftStore";
import { useNewSessionHandler } from "./useHandleNewSession";
import { ensureEnvironmentApi, readEnvironmentApi } from "../environmentApi";
import { invalidateGitQueries } from "../lib/gitReactQuery";
import { refreshArchivedSessionsForEnvironment } from "../lib/archivedSessionsState";
import { newCommandId } from "../lib/utils";
import { readLocalApi } from "../localApi";
import {
  selectProjectByRef,
  selectSessionByRef,
  selectSessionsForEnvironment,
  useStore,
} from "../store";
import { useTerminalStateStore } from "../terminalStateStore";
import { buildSessionRouteParams, resolveSessionRouteRef } from "../sessionRoutes";
import {
  formatWorktreePathForDisplay,
  getOrphanedWorktreePathForSession,
} from "../worktreeCleanup";
import { stackedSessionToast, toastManager } from "../components/ui/toast";
import { useSettings } from "./useSettings";

export function useSessionActions() {
  const sidebarSessionSortOrder = useSettings((settings) => settings.sidebarSessionSortOrder);
  const confirmSessionDelete = useSettings((settings) => settings.confirmSessionDelete);
  const clearComposerDraftForSession = useComposerDraftStore((store) => store.clearDraftSession);
  const clearProjectDraftSessionById = useComposerDraftStore(
    (store) => store.clearProjectDraftSessionById,
  );
  const clearTerminalState = useTerminalStateStore((state) => state.clearTerminalState);
  const router = useRouter();
  const { handleNewSession } = useNewSessionHandler();
  // Keep a ref so archiveSession can call handleNewSession without appearing in
  // its dependency array — handleNewSession is inherently unstable (depends on
  // the projects list) and would otherwise cascade new references into every
  // sidebar row via archiveSession → attemptArchiveSession.
  const handleNewSessionRef = useRef(handleNewSession);
  handleNewSessionRef.current = handleNewSession;
  const queryClient = useQueryClient();

  const resolveSessionTarget = useCallback((target: ScopedSessionRef) => {
    const state = useStore.getState();
    const session = selectSessionByRef(state, target);
    if (!session) {
      return null;
    }
    return {
      session,
      sessionRef: target,
    };
  }, []);
  const getCurrentRouteSessionRef = useCallback(() => {
    const currentRouteParams = router.state.matches[router.state.matches.length - 1]?.params ?? {};
    return resolveSessionRouteRef(currentRouteParams);
  }, [router]);

  const archiveSession = useCallback(
    async (target: ScopedSessionRef) => {
      const api = readEnvironmentApi(target.environmentId);
      if (!api) return;
      const resolved = resolveSessionTarget(target);
      if (!resolved) return;
      const { session, sessionRef } = resolved;
      if (session.session?.status === "running" && session.session.activeTurnId != null) {
        throw new Error("Cannot archive a running session.");
      }

      const currentRouteSessionRef = getCurrentRouteSessionRef();
      const shouldNavigateToDraft =
        currentRouteSessionRef?.sessionId === sessionRef.sessionId &&
        currentRouteSessionRef.environmentId === sessionRef.environmentId;
      const archiveCommand = api.orchestration.dispatchCommand({
        type: "session.archive",
        commandId: newCommandId(),
        sessionId: sessionRef.sessionId,
      });

      if (shouldNavigateToDraft) {
        await handleNewSessionRef.current(
          scopeProjectRef(session.environmentId, session.projectId),
        );
      }

      await archiveCommand;
      refreshArchivedSessionsForEnvironment(sessionRef.environmentId);
    },
    [getCurrentRouteSessionRef, resolveSessionTarget],
  );

  const unarchiveSession = useCallback(async (target: ScopedSessionRef) => {
    const api = readEnvironmentApi(target.environmentId);
    if (!api) return;
    await api.orchestration.dispatchCommand({
      type: "session.unarchive",
      commandId: newCommandId(),
      sessionId: target.sessionId,
    });
    refreshArchivedSessionsForEnvironment(target.environmentId);
  }, []);

  const deleteSession = useCallback(
    async (target: ScopedSessionRef, opts: { deletedSessionKeys?: ReadonlySet<string> } = {}) => {
      const api = readEnvironmentApi(target.environmentId);
      if (!api) return;
      const resolved = resolveSessionTarget(target);
      if (!resolved) {
        // Session not in main store (e.g. archived session) — dispatch delete directly.
        await api.orchestration.dispatchCommand({
          type: "session.delete",
          commandId: newCommandId(),
          sessionId: target.sessionId,
        });
        refreshArchivedSessionsForEnvironment(target.environmentId);
        return;
      }
      const { session, sessionRef } = resolved;
      const state = useStore.getState();
      const sessions = selectSessionsForEnvironment(state, sessionRef.environmentId);
      const sessionProject = selectProjectByRef(state, {
        environmentId: sessionRef.environmentId,
        projectId: session.projectId,
      });
      const deletedIds =
        opts.deletedSessionKeys && opts.deletedSessionKeys.size > 0
          ? new Set<SessionId>(
              [...opts.deletedSessionKeys].flatMap((sessionKey) => {
                const ref = parseScopedSessionKey(sessionKey);
                return ref && ref.environmentId === sessionRef.environmentId ? [ref.sessionId] : [];
              }),
            )
          : undefined;
      const survivingSessions =
        deletedIds && deletedIds.size > 0
          ? sessions.filter(
              (entry) => entry.id === sessionRef.sessionId || !deletedIds.has(entry.id),
            )
          : sessions;
      const orphanedWorktreePath = getOrphanedWorktreePathForSession(
        survivingSessions,
        sessionRef.sessionId,
      );
      const displayWorktreePath = orphanedWorktreePath
        ? formatWorktreePathForDisplay(orphanedWorktreePath)
        : null;
      const canDeleteWorktree = orphanedWorktreePath !== null && sessionProject !== undefined;
      const localApi = readLocalApi();
      const shouldDeleteWorktree =
        canDeleteWorktree &&
        localApi &&
        (await localApi.dialogs.confirm(
          [
            "This session is the only one linked to this worktree:",
            displayWorktreePath ?? orphanedWorktreePath,
            "",
            "Delete the worktree too?",
          ].join("\n"),
        ));

      if (session.session && session.session.status !== "closed") {
        await api.orchestration
          .dispatchCommand({
            type: "session.session.stop",
            commandId: newCommandId(),
            sessionId: sessionRef.sessionId,
            createdAt: new Date().toISOString(),
          })
          .catch(() => undefined);
      }

      try {
        await api.terminal.close({ sessionId: sessionRef.sessionId, deleteHistory: true });
      } catch {
        // Terminal may already be closed.
      }

      const deletedSessionIds = deletedIds ?? new Set<SessionId>();
      const currentRouteSessionRef = getCurrentRouteSessionRef();
      const shouldNavigateToFallback =
        currentRouteSessionRef?.sessionId === sessionRef.sessionId &&
        currentRouteSessionRef.environmentId === sessionRef.environmentId;
      const fallbackSessionId = getFallbackSessionIdAfterDelete({
        sessions,
        deletedSessionId: sessionRef.sessionId,
        deletedSessionIds,
        sortOrder: sidebarSessionSortOrder,
      });
      await api.orchestration.dispatchCommand({
        type: "session.delete",
        commandId: newCommandId(),
        sessionId: sessionRef.sessionId,
      });
      refreshArchivedSessionsForEnvironment(sessionRef.environmentId);
      clearComposerDraftForSession(sessionRef);
      clearProjectDraftSessionById(
        scopeProjectRef(sessionRef.environmentId, session.projectId),
        sessionRef,
      );
      clearTerminalState(sessionRef);

      if (shouldNavigateToFallback) {
        if (fallbackSessionId) {
          const fallbackSession = selectSessionByRef(
            useStore.getState(),
            scopeSessionRef(sessionRef.environmentId, fallbackSessionId),
          );
          if (fallbackSession) {
            await router.navigate({
              to: "/$environmentId/$sessionId",
              params: buildSessionRouteParams(
                scopeSessionRef(fallbackSession.environmentId, fallbackSession.id),
              ),
              replace: true,
            });
          } else {
            await router.navigate({ to: "/", replace: true });
          }
        } else {
          await router.navigate({ to: "/", replace: true });
        }
      }

      if (!shouldDeleteWorktree || !orphanedWorktreePath || !sessionProject) {
        return;
      }

      try {
        await ensureEnvironmentApi(sessionRef.environmentId).vcs.removeWorktree({
          cwd: sessionProject.cwd,
          path: orphanedWorktreePath,
          force: true,
        });
        await invalidateGitQueries(queryClient, {
          environmentId: sessionRef.environmentId,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error removing worktree.";
        console.error("Failed to remove orphaned worktree after session deletion", {
          sessionId: sessionRef.sessionId,
          projectCwd: sessionProject.cwd,
          worktreePath: orphanedWorktreePath,
          error,
        });
        toastManager.add(
          stackedSessionToast({
            type: "error",
            title: "Session deleted, but worktree removal failed",
            description: `Could not remove ${displayWorktreePath ?? orphanedWorktreePath}. ${message}`,
          }),
        );
      }
    },
    [
      clearComposerDraftForSession,
      clearProjectDraftSessionById,
      clearTerminalState,
      getCurrentRouteSessionRef,
      router,
      queryClient,
      resolveSessionTarget,
      sidebarSessionSortOrder,
    ],
  );

  const confirmAndDeleteSession = useCallback(
    async (target: ScopedSessionRef) => {
      const api = readEnvironmentApi(target.environmentId);
      if (!api) return;
      const localApi = readLocalApi();
      const resolved = resolveSessionTarget(target);

      if (confirmSessionDelete && localApi) {
        const title = resolved?.session.title ?? "this session";
        const confirmed = await localApi.dialogs.confirm(
          [
            `Delete session "${title}"?`,
            "This permanently clears conversation history for this session.",
          ].join("\n"),
        );
        if (!confirmed) {
          return;
        }
      }

      await deleteSession(target);
    },
    [confirmSessionDelete, deleteSession, resolveSessionTarget],
  );

  return {
    archiveSession,
    unarchiveSession,
    deleteSession,
    confirmAndDeleteSession,
  };
}
