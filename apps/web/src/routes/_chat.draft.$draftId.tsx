import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo } from "react";
import ChatView from "../components/ChatView";
import { sessionHasStarted } from "../components/ChatView.logic";
import { useComposerDraftStore, DraftId } from "../composerDraftStore";
import { SidebarInset } from "../components/ui/sidebar";
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
      <SidebarInset className="h-svh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground md:h-dvh">
        <ChatView
          environmentId={canonicalSessionRef.environmentId}
          sessionId={canonicalSessionRef.sessionId}
          routeKind="server"
        />
      </SidebarInset>
    );
  }

  if (!draftSession) {
    return null;
  }

  return (
    <SidebarInset className="h-svh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground md:h-dvh">
      <ChatView
        draftId={draftId}
        environmentId={draftSession.environmentId}
        sessionId={draftSession.sessionId}
        routeKind="draft"
      />
    </SidebarInset>
  );
}

export const Route = createFileRoute("/_chat/draft/$draftId")({
  component: DraftChatSessionRouteView,
});
