import { createFileRoute, retainSearchParams, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";

import ChatView from "../components/ChatView";
import { sessionHasStarted } from "../components/ChatView.logic";
import { finalizePromotedDraftSessionByRef, useComposerDraftStore } from "../composerDraftStore";
import {
  type DiffRouteSearch,
  parseDiffRouteSearch,
  stripDiffSearchParams,
} from "../diffRouteSearch";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { RIGHT_PANEL_SHEET_MEDIA_QUERY } from "../rightPanelLayout";
import { selectEnvironmentState, selectSessionExistsByRef, useStore } from "../store";
import { createSessionSelectorByRef } from "../storeSelectors";
import { resolveSessionRouteRef, buildSessionRouteParams } from "../sessionRoutes";
import { RightPanelSheet } from "../components/RightPanelSheet";
import { AppMainSurface } from "../components/appShell";
import { LazyDiffPanel, RightPanelInlineSidebar } from "../components/RightPanelRouteShell";

function ChatSessionRouteView() {
  const navigate = useNavigate();
  const sessionRef = Route.useParams({
    select: (params) => resolveSessionRouteRef(params),
  });
  const search = Route.useSearch();
  const bootstrapComplete = useStore(
    (store) => selectEnvironmentState(store, sessionRef?.environmentId ?? null).bootstrapComplete,
  );
  const serverSession = useStore(
    useMemo(() => createSessionSelectorByRef(sessionRef), [sessionRef]),
  );
  const sessionExists = useStore((store) => selectSessionExistsByRef(store, sessionRef));
  const environmentHasServerSessions = useStore(
    (store) =>
      selectEnvironmentState(store, sessionRef?.environmentId ?? null).sessionIds.length > 0,
  );
  const draftSessionExists = useComposerDraftStore((store) =>
    sessionRef ? store.getDraftSessionByRef(sessionRef) !== null : false,
  );
  const draftSession = useComposerDraftStore((store) =>
    sessionRef ? store.getDraftSessionByRef(sessionRef) : null,
  );
  const environmentHasDraftSessions = useComposerDraftStore((store) => {
    if (!sessionRef) {
      return false;
    }
    return store.hasDraftSessionsInEnvironment(sessionRef.environmentId);
  });
  const routeSessionExists = sessionExists || draftSessionExists;
  const serverSessionStarted = sessionHasStarted(serverSession);
  const environmentHasAnySessions = environmentHasServerSessions || environmentHasDraftSessions;
  const diffOpen = search.diff === "1";
  const rightPanelOpen = diffOpen;
  const shouldUseRightPanelSheet = useMediaQuery(RIGHT_PANEL_SHEET_MEDIA_QUERY);
  const currentSessionKey = sessionRef
    ? `${sessionRef.environmentId}:${sessionRef.sessionId}`
    : null;
  const [rightPanelMountState, setRightPanelMountState] = useState(() => ({
    sessionKey: currentSessionKey,
    hasOpenedDiff: diffOpen,
  }));
  const hasOpenedDiff =
    rightPanelMountState.sessionKey === currentSessionKey
      ? rightPanelMountState.hasOpenedDiff
      : diffOpen;
  const markDiffOpened = useCallback(() => {
    setRightPanelMountState((previous) => {
      if (previous.sessionKey === currentSessionKey && previous.hasOpenedDiff) {
        return previous;
      }
      return {
        sessionKey: currentSessionKey,
        hasOpenedDiff: true,
      };
    });
  }, [currentSessionKey]);
  const closeDiff = useCallback(() => {
    if (!sessionRef) {
      return;
    }
    void navigate({
      to: "/$environmentId/$sessionId",
      params: buildSessionRouteParams(sessionRef),
      search: { diff: undefined },
    });
  }, [navigate, sessionRef]);
  const openDiff = useCallback(() => {
    if (!sessionRef) {
      return;
    }
    markDiffOpened();
    void navigate({
      to: "/$environmentId/$sessionId",
      params: buildSessionRouteParams(sessionRef),
      search: (previous) => {
        const rest = stripDiffSearchParams(previous);
        return { ...rest, diff: "1" };
      },
    });
  }, [markDiffOpened, navigate, sessionRef]);

  useEffect(() => {
    if (!sessionRef || !bootstrapComplete) {
      return;
    }

    if (!routeSessionExists && environmentHasAnySessions) {
      void navigate({ to: "/", replace: true });
    }
  }, [bootstrapComplete, environmentHasAnySessions, navigate, routeSessionExists, sessionRef]);

  useEffect(() => {
    if (!sessionRef || !serverSessionStarted || !draftSession?.promotedTo) {
      return;
    }
    finalizePromotedDraftSessionByRef(sessionRef);
  }, [draftSession?.promotedTo, serverSessionStarted, sessionRef]);

  if (!sessionRef || !bootstrapComplete || !routeSessionExists) {
    return null;
  }

  const shouldRenderDiffContent = diffOpen || hasOpenedDiff;
  const rightPanelContent = shouldRenderDiffContent ? (
    <LazyDiffPanel mode={shouldUseRightPanelSheet ? "sheet" : "sidebar"} />
  ) : null;

  if (!shouldUseRightPanelSheet) {
    return (
      <>
        <AppMainSurface>
          <ChatView
            environmentId={sessionRef.environmentId}
            sessionId={sessionRef.sessionId}
            onDiffPanelOpen={markDiffOpened}
            reserveTitleBarControlInset={!rightPanelOpen}
            routeKind="server"
          />
        </AppMainSurface>
        <RightPanelInlineSidebar open={rightPanelOpen} onClose={closeDiff} onOpen={openDiff}>
          {rightPanelContent}
        </RightPanelInlineSidebar>
      </>
    );
  }

  return (
    <>
      <AppMainSurface>
        <ChatView
          environmentId={sessionRef.environmentId}
          sessionId={sessionRef.sessionId}
          onDiffPanelOpen={markDiffOpened}
          routeKind="server"
        />
      </AppMainSurface>
      <RightPanelSheet open={rightPanelOpen} onClose={closeDiff}>
        {rightPanelContent}
      </RightPanelSheet>
    </>
  );
}

export const Route = createFileRoute("/_chat/$environmentId/$sessionId")({
  validateSearch: (search) => parseDiffRouteSearch(search),
  search: {
    middlewares: [retainSearchParams<DiffRouteSearch>(["diff"])],
  },
  component: ChatSessionRouteView,
});
