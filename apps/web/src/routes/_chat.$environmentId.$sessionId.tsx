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
import {
  LazyDiffPanel,
  LazyResearchCardsPanel,
  RightPanelInlineSidebar,
} from "../components/RightPanelRouteShell";

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
  const cardsOpen = search.cards === "1";
  const rightPanelOpen = diffOpen || cardsOpen;
  const shouldUseRightPanelSheet = useMediaQuery(RIGHT_PANEL_SHEET_MEDIA_QUERY);
  const currentSessionKey = sessionRef
    ? `${sessionRef.environmentId}:${sessionRef.sessionId}`
    : null;
  const [rightPanelMountState, setRightPanelMountState] = useState(() => ({
    sessionKey: currentSessionKey,
    hasOpenedDiff: diffOpen,
    hasOpenedCards: cardsOpen,
  }));
  const hasOpenedDiff =
    rightPanelMountState.sessionKey === currentSessionKey
      ? rightPanelMountState.hasOpenedDiff
      : diffOpen;
  const hasOpenedCards =
    rightPanelMountState.sessionKey === currentSessionKey
      ? rightPanelMountState.hasOpenedCards
      : cardsOpen;
  const markDiffOpened = useCallback(() => {
    setRightPanelMountState((previous) => {
      if (previous.sessionKey === currentSessionKey && previous.hasOpenedDiff) {
        return previous;
      }
      return {
        sessionKey: currentSessionKey,
        hasOpenedDiff: true,
        hasOpenedCards:
          previous.sessionKey === currentSessionKey ? previous.hasOpenedCards : cardsOpen,
      };
    });
  }, [cardsOpen, currentSessionKey]);
  const markCardsOpened = useCallback(() => {
    setRightPanelMountState((previous) => {
      if (previous.sessionKey === currentSessionKey && previous.hasOpenedCards) {
        return previous;
      }
      return {
        sessionKey: currentSessionKey,
        hasOpenedDiff:
          previous.sessionKey === currentSessionKey ? previous.hasOpenedDiff : diffOpen,
        hasOpenedCards: true,
      };
    });
  }, [currentSessionKey, diffOpen]);
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
        return { ...rest, cards: undefined, diff: "1" };
      },
    });
  }, [markDiffOpened, navigate, sessionRef]);
  const closeCards = useCallback(() => {
    if (!sessionRef) {
      return;
    }
    void navigate({
      to: "/$environmentId/$sessionId",
      params: buildSessionRouteParams(sessionRef),
      search: { cards: undefined },
    });
  }, [navigate, sessionRef]);
  const openCards = useCallback(() => {
    if (!sessionRef) {
      return;
    }
    markCardsOpened();
    void navigate({
      to: "/$environmentId/$sessionId",
      params: buildSessionRouteParams(sessionRef),
      search: (previous) => {
        const rest = stripDiffSearchParams(previous);
        return {
          ...rest,
          diff: undefined,
          diffTurnId: undefined,
          diffFilePath: undefined,
          cards: "1",
        };
      },
    });
  }, [markCardsOpened, navigate, sessionRef]);
  const closeRightPanel = diffOpen ? closeDiff : closeCards;
  const openRightPanel = diffOpen ? openDiff : openCards;

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
  const shouldRenderCardsContent = cardsOpen || hasOpenedCards;
  const rightPanelContent = diffOpen ? (
    shouldRenderDiffContent ? (
      <LazyDiffPanel mode={shouldUseRightPanelSheet ? "sheet" : "sidebar"} />
    ) : null
  ) : shouldRenderCardsContent ? (
    <LazyResearchCardsPanel mode={shouldUseRightPanelSheet ? "sheet" : "sidebar"} />
  ) : null;

  if (!shouldUseRightPanelSheet) {
    return (
      <>
        <AppMainSurface>
          <ChatView
            environmentId={sessionRef.environmentId}
            sessionId={sessionRef.sessionId}
            onDiffPanelOpen={markDiffOpened}
            onResearchCardsPanelOpen={markCardsOpened}
            reserveTitleBarControlInset={!rightPanelOpen}
            routeKind="server"
          />
        </AppMainSurface>
        <RightPanelInlineSidebar
          open={rightPanelOpen}
          onClose={closeRightPanel}
          onOpen={openRightPanel}
        >
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
          onResearchCardsPanelOpen={markCardsOpened}
          routeKind="server"
        />
      </AppMainSurface>
      <RightPanelSheet open={rightPanelOpen} onClose={closeRightPanel}>
        {rightPanelContent}
      </RightPanelSheet>
    </>
  );
}

export const Route = createFileRoute("/_chat/$environmentId/$sessionId")({
  validateSearch: (search) => parseDiffRouteSearch(search),
  search: {
    middlewares: [retainSearchParams<DiffRouteSearch>(["diff", "cards"])],
  },
  component: ChatSessionRouteView,
});
