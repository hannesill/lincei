import { createFileRoute, retainSearchParams, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import ChatView from "../components/ChatView";
import { sessionHasStarted } from "../components/ChatView.logic";
import { useComposerDraftStore, DraftId } from "../composerDraftStore";
import { AppMainSurface } from "../components/appShell";
import { createSessionSelectorAcrossEnvironments } from "../storeSelectors";
import { useStore } from "../store";
import { buildDraftSessionRouteParams, buildSessionRouteParams } from "../sessionRoutes";
import { RightPanelSheet } from "../components/RightPanelSheet";
import {
  LazyResearchCardsPanel,
  RightPanelInlineSidebar,
} from "../components/RightPanelRouteShell";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { RIGHT_PANEL_SHEET_MEDIA_QUERY } from "../rightPanelLayout";
import { parseDiffRouteSearch, stripDiffSearchParams } from "../diffRouteSearch";

export interface DraftCardsRouteSearch {
  cards?: "1" | undefined;
}

function DraftChatSessionRouteView() {
  const navigate = useNavigate();
  const { draftId: rawDraftId } = Route.useParams();
  const search = Route.useSearch();
  const draftId = DraftId.make(rawDraftId);
  const draftSession = useComposerDraftStore((store) => store.getDraftSession(draftId));
  const cardsOpen = search.cards === "1";
  const shouldUseRightPanelSheet = useMediaQuery(RIGHT_PANEL_SHEET_MEDIA_QUERY);
  const [hasOpenedCards, setHasOpenedCards] = useState(cardsOpen);
  const serverSession = useStore(
    useMemo(
      () => createSessionSelectorAcrossEnvironments(draftSession?.sessionId ?? null),
      [draftSession?.sessionId],
    ),
  );
  const serverSessionStarted = sessionHasStarted(serverSession);
  const canonicalSessionRef = useMemo(
    () =>
      draftSession?.promotedTo
        ? serverSessionStarted
          ? draftSession.promotedTo
          : null
        : serverSession
          ? {
              environmentId: serverSession.environmentId,
              sessionId: serverSession.id,
            }
          : null,
    [draftSession?.promotedTo, serverSession, serverSessionStarted],
  );
  const markCardsOpened = useCallback(() => {
    setHasOpenedCards(true);
  }, []);
  const closeCards = useCallback(() => {
    void navigate({
      to: "/draft/$draftId",
      params: buildDraftSessionRouteParams(draftId),
      search: { cards: undefined },
    });
  }, [draftId, navigate]);
  const openCards = useCallback(() => {
    markCardsOpened();
    void navigate({
      to: "/draft/$draftId",
      params: buildDraftSessionRouteParams(draftId),
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
  }, [draftId, markCardsOpened, navigate]);

  useEffect(() => {
    if (!canonicalSessionRef) {
      return;
    }
    void navigate({
      to: "/$environmentId/$sessionId",
      params: buildSessionRouteParams(canonicalSessionRef),
      search: cardsOpen ? { cards: "1" } : {},
      replace: true,
    });
  }, [canonicalSessionRef, cardsOpen, navigate]);

  useEffect(() => {
    if (draftSession || canonicalSessionRef) {
      return;
    }
    void navigate({ to: "/", replace: true });
  }, [canonicalSessionRef, draftSession, navigate]);

  if (canonicalSessionRef) {
    return (
      <AppMainSurface>
        <ChatView
          environmentId={canonicalSessionRef.environmentId}
          sessionId={canonicalSessionRef.sessionId}
          routeKind="server"
        />
      </AppMainSurface>
    );
  }

  if (!draftSession) {
    return null;
  }

  const shouldRenderCardsContent = cardsOpen || hasOpenedCards;
  const rightPanelContent = shouldRenderCardsContent ? (
    <LazyResearchCardsPanel mode={shouldUseRightPanelSheet ? "sheet" : "sidebar"} />
  ) : null;

  if (!shouldUseRightPanelSheet) {
    return (
      <>
        <AppMainSurface>
          <ChatView
            draftId={draftId}
            environmentId={draftSession.environmentId}
            sessionId={draftSession.sessionId}
            onResearchCardsPanelOpen={markCardsOpened}
            reserveTitleBarControlInset={!cardsOpen}
            routeKind="draft"
          />
        </AppMainSurface>
        <RightPanelInlineSidebar open={cardsOpen} onClose={closeCards} onOpen={openCards}>
          {rightPanelContent}
        </RightPanelInlineSidebar>
      </>
    );
  }

  return (
    <>
      <AppMainSurface>
        <ChatView
          draftId={draftId}
          environmentId={draftSession.environmentId}
          sessionId={draftSession.sessionId}
          onResearchCardsPanelOpen={markCardsOpened}
          routeKind="draft"
        />
      </AppMainSurface>
      <RightPanelSheet open={cardsOpen} onClose={closeCards}>
        {rightPanelContent}
      </RightPanelSheet>
    </>
  );
}

export const Route = createFileRoute("/_chat/draft/$draftId")({
  validateSearch: (search): DraftCardsRouteSearch => {
    const parsed = parseDiffRouteSearch(search);
    return parsed.cards ? { cards: parsed.cards } : {};
  },
  search: {
    middlewares: [retainSearchParams<DraftCardsRouteSearch>(["cards"])],
  },
  component: DraftChatSessionRouteView,
});
