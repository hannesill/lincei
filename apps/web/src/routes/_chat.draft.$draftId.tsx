import { scopeSessionRef } from "@t3tools/client-runtime";
import { createFileRoute, retainSearchParams, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo } from "react";

import ChatView from "../components/ChatView";
import { sessionHasStarted } from "../components/ChatView.logic";
import { RightPanelSheet } from "../components/RightPanelSheet";
import { LazyPreviewPanel, RightPanelInlineSidebar } from "../components/RightPanelRouteShell";
import { AppMainSurface } from "../components/appShell";
import { DraftId, useComposerDraftStore } from "../composerDraftStore";
import { parseDiffRouteSearch, stripDiffSearchParams } from "../diffRouteSearch";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { RIGHT_PANEL_SHEET_MEDIA_QUERY } from "../rightPanelLayout";
import { buildDraftSessionRouteParams, buildSessionRouteParams } from "../sessionRoutes";
import { useStore } from "../store";
import { createSessionSelectorAcrossEnvironments } from "../storeSelectors";

interface DraftPreviewRouteSearch {
  preview?: "1" | undefined;
}

function DraftChatSessionRouteView() {
  const navigate = useNavigate();
  const { draftId: rawDraftId } = Route.useParams();
  const search = Route.useSearch();
  const draftId = DraftId.make(rawDraftId);
  const draftSession = useComposerDraftStore((store) => store.getDraftSession(draftId));
  const previewOpen = search.preview === "1";
  const shouldUseRightPanelSheet = useMediaQuery(RIGHT_PANEL_SHEET_MEDIA_QUERY);
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
  const closePreview = useCallback(() => {
    void navigate({
      to: "/draft/$draftId",
      params: buildDraftSessionRouteParams(draftId),
      search: { preview: undefined },
    });
  }, [draftId, navigate]);
  const openPreview = useCallback(() => {
    void navigate({
      to: "/draft/$draftId",
      params: buildDraftSessionRouteParams(draftId),
      search: (previous) => ({ ...stripDiffSearchParams(previous), preview: "1" }),
    });
  }, [draftId, navigate]);

  useEffect(() => {
    if (!canonicalSessionRef) {
      return;
    }
    void navigate({
      to: "/$environmentId/$sessionId",
      params: buildSessionRouteParams(canonicalSessionRef),
      search: previewOpen ? { preview: "1" } : {},
      replace: true,
    });
  }, [canonicalSessionRef, navigate, previewOpen]);

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

  const previewSessionRef = scopeSessionRef(draftSession.environmentId, draftSession.sessionId);
  const rightPanelContent = previewOpen ? (
    <LazyPreviewPanel
      mode={shouldUseRightPanelSheet ? "sheet" : "sidebar"}
      sessionRef={previewSessionRef}
      onClosePanel={closePreview}
    />
  ) : null;

  if (!shouldUseRightPanelSheet) {
    return (
      <>
        <AppMainSurface>
          <ChatView
            draftId={draftId}
            environmentId={draftSession.environmentId}
            sessionId={draftSession.sessionId}
            reserveTitleBarControlInset={!previewOpen}
            routeKind="draft"
          />
        </AppMainSurface>
        <RightPanelInlineSidebar
          open={previewOpen}
          onClose={closePreview}
          onOpen={openPreview}
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
          draftId={draftId}
          environmentId={draftSession.environmentId}
          sessionId={draftSession.sessionId}
          routeKind="draft"
        />
      </AppMainSurface>
      <RightPanelSheet open={previewOpen} onClose={closePreview}>
        {rightPanelContent}
      </RightPanelSheet>
    </>
  );
}

export const Route = createFileRoute("/_chat/draft/$draftId")({
  validateSearch: (search): DraftPreviewRouteSearch => {
    const parsed = parseDiffRouteSearch(search);
    return parsed.preview ? { preview: parsed.preview } : {};
  },
  search: {
    middlewares: [retainSearchParams<DraftPreviewRouteSearch>(["preview"])],
  },
  component: DraftChatSessionRouteView,
});
