import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo } from "react";

import ChatView from "../components/ChatView";
import { sessionHasStarted } from "../components/ChatView.logic";
import { DraftId, useComposerDraftStore } from "../composerDraftStore";
import { AppMainSurface } from "../components/appShell";
import { createSessionSelectorAcrossEnvironments } from "../storeSelectors";
import { useStore } from "../store";
import { buildSessionRouteParams } from "../sessionRoutes";

function DraftChatSessionRouteView() {
  const navigate = useNavigate();
  const { draftId: rawDraftId } = Route.useParams();
  const draftId = DraftId.make(rawDraftId);
  const draftSession = useComposerDraftStore((store) => store.getDraftSession(draftId));
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

  useEffect(() => {
    if (!canonicalSessionRef) {
      return;
    }
    void navigate({
      to: "/$environmentId/$sessionId",
      params: buildSessionRouteParams(canonicalSessionRef),
      search: {},
      replace: true,
    });
  }, [canonicalSessionRef, navigate]);

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

  return (
    <AppMainSurface>
      <ChatView
        draftId={draftId}
        environmentId={draftSession.environmentId}
        sessionId={draftSession.sessionId}
        routeKind="draft"
      />
    </AppMainSurface>
  );
}

export const Route = createFileRoute("/_chat/draft/$draftId")({
  component: DraftChatSessionRouteView,
});
