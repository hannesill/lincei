import { scopedProjectKey, scopeProjectRef } from "@t3tools/client-runtime";
import { DEFAULT_RUNTIME_MODE, type ScopedProjectRef } from "@t3tools/contracts";
import { useParams, useRouter } from "@tanstack/react-router";
import { useCallback, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  type DraftSessionEnvMode,
  type DraftSessionState,
  useComposerDraftStore,
} from "../composerDraftStore";
import { newDraftId, newSessionId } from "../lib/utils";
import { orderItemsByPreferredIds } from "../components/Sidebar.logic";
import {
  deriveLogicalProjectKeyFromSettings,
  getProjectOrderKey,
  selectProjectGroupingSettings,
} from "../logicalProject";
import { selectProjectsAcrossEnvironments, useStore } from "../store";
import { createSessionSelectorByRef } from "../storeSelectors";
import { resolveSessionRouteTarget } from "../sessionRoutes";
import { useUiStateStore } from "../uiStateStore";
import { useSettings } from "./useSettings";

function useNewSessionState() {
  const projects = useStore(useShallow((store) => selectProjectsAcrossEnvironments(store)));
  const projectGroupingSettings = useSettings(selectProjectGroupingSettings);
  const router = useRouter();
  const getCurrentRouteTarget = useCallback(() => {
    const currentRouteParams = router.state.matches[router.state.matches.length - 1]?.params ?? {};
    return resolveSessionRouteTarget(currentRouteParams);
  }, [router]);

  return useCallback(
    (
      projectRef: ScopedProjectRef,
      options?: {
        branch?: string | null;
        worktreePath?: string | null;
        envMode?: DraftSessionEnvMode;
      },
    ): Promise<void> => {
      const {
        getDraftSessionByLogicalProjectKey,
        getDraftSession,
        applyStickyState,
        setDraftSessionContext,
        setLogicalProjectDraftSessionId,
      } = useComposerDraftStore.getState();
      const currentRouteTarget = getCurrentRouteTarget();
      const project = projects.find(
        (candidate) =>
          candidate.id === projectRef.projectId &&
          candidate.environmentId === projectRef.environmentId,
      );
      const logicalProjectKey = project
        ? deriveLogicalProjectKeyFromSettings(project, projectGroupingSettings)
        : scopedProjectKey(projectRef);
      const hasBranchOption = options?.branch !== undefined;
      const hasWorktreePathOption = options?.worktreePath !== undefined;
      const hasEnvModeOption = options?.envMode !== undefined;
      const storedDraftSession = getDraftSessionByLogicalProjectKey(logicalProjectKey);
      const latestActiveDraftSession: DraftSessionState | null = currentRouteTarget
        ? currentRouteTarget.kind === "server"
          ? getDraftSession(currentRouteTarget.sessionRef)
          : getDraftSession(currentRouteTarget.draftId)
        : null;
      if (storedDraftSession) {
        return (async () => {
          if (hasBranchOption || hasWorktreePathOption || hasEnvModeOption) {
            setDraftSessionContext(storedDraftSession.draftId, {
              ...(hasBranchOption ? { branch: options?.branch ?? null } : {}),
              ...(hasWorktreePathOption ? { worktreePath: options?.worktreePath ?? null } : {}),
              ...(hasEnvModeOption ? { envMode: options?.envMode } : {}),
            });
          }
          setLogicalProjectDraftSessionId(
            logicalProjectKey,
            projectRef,
            storedDraftSession.draftId,
            {
              sessionId: storedDraftSession.sessionId,
            },
          );
          if (
            currentRouteTarget?.kind === "draft" &&
            currentRouteTarget.draftId === storedDraftSession.draftId
          ) {
            return;
          }
          await router.navigate({
            to: "/draft/$draftId",
            params: { draftId: storedDraftSession.draftId },
          });
        })();
      }

      if (
        latestActiveDraftSession &&
        currentRouteTarget?.kind === "draft" &&
        latestActiveDraftSession.logicalProjectKey === logicalProjectKey &&
        latestActiveDraftSession.promotedTo == null
      ) {
        if (hasBranchOption || hasWorktreePathOption || hasEnvModeOption) {
          setDraftSessionContext(currentRouteTarget.draftId, {
            ...(hasBranchOption ? { branch: options?.branch ?? null } : {}),
            ...(hasWorktreePathOption ? { worktreePath: options?.worktreePath ?? null } : {}),
            ...(hasEnvModeOption ? { envMode: options?.envMode } : {}),
          });
        }
        setLogicalProjectDraftSessionId(logicalProjectKey, projectRef, currentRouteTarget.draftId, {
          sessionId: latestActiveDraftSession.sessionId,
          createdAt: latestActiveDraftSession.createdAt,
          runtimeMode: latestActiveDraftSession.runtimeMode,
          interactionMode: latestActiveDraftSession.interactionMode,
          ...(hasBranchOption ? { branch: options?.branch ?? null } : {}),
          ...(hasWorktreePathOption ? { worktreePath: options?.worktreePath ?? null } : {}),
          ...(hasEnvModeOption ? { envMode: options?.envMode } : {}),
        });
        return Promise.resolve();
      }

      const draftId = newDraftId();
      const sessionId = newSessionId();
      const createdAt = new Date().toISOString();
      return (async () => {
        setLogicalProjectDraftSessionId(logicalProjectKey, projectRef, draftId, {
          sessionId,
          createdAt,
          branch: options?.branch ?? null,
          worktreePath: options?.worktreePath ?? null,
          envMode: options?.envMode ?? "local",
          runtimeMode: DEFAULT_RUNTIME_MODE,
        });
        applyStickyState(draftId);

        await router.navigate({
          to: "/draft/$draftId",
          params: { draftId },
        });
      })();
    },
    [getCurrentRouteTarget, projectGroupingSettings, router, projects],
  );
}

export function useNewSessionHandler() {
  const handleNewSession = useNewSessionState();

  return {
    handleNewSession,
  };
}

export function useHandleNewSession() {
  const projectOrder = useUiStateStore((store) => store.projectOrder);
  const routeTarget = useParams({
    strict: false,
    select: (params) => resolveSessionRouteTarget(params),
  });
  const routeSessionRef = routeTarget?.kind === "server" ? routeTarget.sessionRef : null;
  const activeSession = useStore(
    useMemo(() => createSessionSelectorByRef(routeSessionRef), [routeSessionRef]),
  );
  const getDraftSession = useComposerDraftStore((store) => store.getDraftSession);
  const activeDraftSession = useComposerDraftStore(() =>
    routeTarget
      ? routeTarget.kind === "server"
        ? getDraftSession(routeTarget.sessionRef)
        : useComposerDraftStore.getState().getDraftSession(routeTarget.draftId)
      : null,
  );
  const projects = useStore(useShallow((store) => selectProjectsAcrossEnvironments(store)));
  const orderedProjects = useMemo(() => {
    return orderItemsByPreferredIds({
      items: projects,
      preferredIds: projectOrder,
      getId: getProjectOrderKey,
    });
  }, [projectOrder, projects]);
  const handleNewSession = useNewSessionState();

  return {
    activeDraftSession,
    activeSession,
    defaultProjectRef: orderedProjects[0]
      ? scopeProjectRef(orderedProjects[0].environmentId, orderedProjects[0].id)
      : null,
    handleNewSession,
    routeSessionRef,
  };
}
