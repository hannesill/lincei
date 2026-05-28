import { createFileRoute, retainSearchParams, useNavigate } from "@tanstack/react-router";
import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from "react";

import ChatView from "../components/ChatView";
import { sessionHasStarted } from "../components/ChatView.logic";
import { DiffWorkerPoolProvider } from "../components/DiffWorkerPoolProvider";
import {
  DiffPanelHeaderSkeleton,
  DiffPanelLoadingState,
  DiffPanelShell,
  type DiffPanelMode,
} from "../components/DiffPanelShell";
import { finalizePromotedDraftSessionByRef, useComposerDraftStore } from "../composerDraftStore";
import {
  type DiffRouteSearch,
  parseDiffRouteSearch,
  stripDiffSearchParams,
} from "../diffRouteSearch";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { RIGHT_PANEL_INLINE_LAYOUT_MEDIA_QUERY } from "../rightPanelLayout";
import { selectEnvironmentState, selectSessionExistsByRef, useStore } from "../store";
import { createSessionSelectorByRef } from "../storeSelectors";
import { resolveSessionRouteRef, buildSessionRouteParams } from "../sessionRoutes";
import { RightPanelSheet } from "../components/RightPanelSheet";
import { AppMainSurface } from "../components/appShell";
import { Sidebar, SidebarProvider, SidebarRail } from "~/components/ui/sidebar";

const DiffPanel = lazy(() => import("../components/DiffPanel"));
const DIFF_INLINE_SIDEBAR_WIDTH_STORAGE_KEY = "chat_diff_sidebar_width";
const DIFF_INLINE_DEFAULT_WIDTH = "clamp(24rem,34vw,36rem)";
const DIFF_INLINE_SIDEBAR_MIN_WIDTH = 22 * 16;
const DIFF_INLINE_SIDEBAR_MAX_WIDTH = 256 * 16;
const COMPOSER_COMPACT_MIN_LEFT_CONTROLS_WIDTH_PX = 208;

const DiffLoadingFallback = (props: { mode: DiffPanelMode }) => {
  return (
    <DiffPanelShell mode={props.mode} header={<DiffPanelHeaderSkeleton />}>
      <DiffPanelLoadingState label="Loading diff viewer..." />
    </DiffPanelShell>
  );
};

const LazyDiffPanel = (props: { mode: DiffPanelMode }) => {
  return (
    <DiffWorkerPoolProvider>
      <Suspense fallback={<DiffLoadingFallback mode={props.mode} />}>
        <DiffPanel mode={props.mode} />
      </Suspense>
    </DiffWorkerPoolProvider>
  );
};

const DiffPanelInlineSidebar = (props: {
  diffOpen: boolean;
  onCloseDiff: () => void;
  onOpenDiff: () => void;
  renderDiffContent: boolean;
}) => {
  const { diffOpen, onCloseDiff, onOpenDiff, renderDiffContent } = props;
  const onOpenChange = useCallback(
    (open: boolean) => {
      if (open) {
        onOpenDiff();
        return;
      }
      onCloseDiff();
    },
    [onCloseDiff, onOpenDiff],
  );
  const shouldAcceptInlineSidebarWidth = useCallback(
    ({ nextWidth, wrapper }: { nextWidth: number; wrapper: HTMLElement }) => {
      const composerForm = document.querySelector<HTMLElement>("[data-chat-composer-form='true']");
      if (!composerForm) return true;
      const composerViewport = composerForm.parentElement;
      if (!composerViewport) return true;
      const previousSidebarWidth = wrapper.style.getPropertyValue("--sidebar-width");
      wrapper.style.setProperty("--sidebar-width", `${nextWidth}px`);

      const viewportStyle = window.getComputedStyle(composerViewport);
      const viewportPaddingLeft = Number.parseFloat(viewportStyle.paddingLeft) || 0;
      const viewportPaddingRight = Number.parseFloat(viewportStyle.paddingRight) || 0;
      const viewportContentWidth = Math.max(
        0,
        composerViewport.clientWidth - viewportPaddingLeft - viewportPaddingRight,
      );
      const formRect = composerForm.getBoundingClientRect();
      const composerFooter = composerForm.querySelector<HTMLElement>(
        "[data-chat-composer-footer='true']",
      );
      const composerRightActions = composerForm.querySelector<HTMLElement>(
        "[data-chat-composer-actions='right']",
      );
      const composerRightActionsWidth = composerRightActions?.getBoundingClientRect().width ?? 0;
      const composerFooterGap = composerFooter
        ? Number.parseFloat(window.getComputedStyle(composerFooter).columnGap) ||
          Number.parseFloat(window.getComputedStyle(composerFooter).gap) ||
          0
        : 0;
      const minimumComposerWidth =
        COMPOSER_COMPACT_MIN_LEFT_CONTROLS_WIDTH_PX + composerRightActionsWidth + composerFooterGap;
      const hasComposerOverflow = composerForm.scrollWidth > composerForm.clientWidth + 0.5;
      const overflowsViewport = formRect.width > viewportContentWidth + 0.5;
      const violatesMinimumComposerWidth = composerForm.clientWidth + 0.5 < minimumComposerWidth;

      if (previousSidebarWidth.length > 0) {
        wrapper.style.setProperty("--sidebar-width", previousSidebarWidth);
      } else {
        wrapper.style.removeProperty("--sidebar-width");
      }

      return !hasComposerOverflow && !overflowsViewport && !violatesMinimumComposerWidth;
    },
    [],
  );

  return (
    <SidebarProvider
      defaultOpen={false}
      open={diffOpen}
      onOpenChange={onOpenChange}
      className="w-auto min-h-0 flex-none bg-transparent"
      style={{ "--sidebar-width": DIFF_INLINE_DEFAULT_WIDTH } as React.CSSProperties}
    >
      <Sidebar
        side="right"
        collapsible="offcanvas"
        className="border-l border-border bg-card text-foreground"
        resizable={{
          maxWidth: DIFF_INLINE_SIDEBAR_MAX_WIDTH,
          minWidth: DIFF_INLINE_SIDEBAR_MIN_WIDTH,
          shouldAcceptWidth: shouldAcceptInlineSidebarWidth,
          storageKey: DIFF_INLINE_SIDEBAR_WIDTH_STORAGE_KEY,
        }}
      >
        {renderDiffContent ? <LazyDiffPanel mode="sidebar" /> : null}
        <SidebarRail />
      </Sidebar>
    </SidebarProvider>
  );
};

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
  const shouldUseDiffSheet = useMediaQuery(RIGHT_PANEL_INLINE_LAYOUT_MEDIA_QUERY);
  const currentSessionKey = sessionRef
    ? `${sessionRef.environmentId}:${sessionRef.sessionId}`
    : null;
  const [diffPanelMountState, setDiffPanelMountState] = useState(() => ({
    sessionKey: currentSessionKey,
    hasOpenedDiff: diffOpen,
  }));
  const hasOpenedDiff =
    diffPanelMountState.sessionKey === currentSessionKey
      ? diffPanelMountState.hasOpenedDiff
      : diffOpen;
  const markDiffOpened = useCallback(() => {
    setDiffPanelMountState((previous) => {
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

  if (!shouldUseDiffSheet) {
    return (
      <>
        <AppMainSurface>
          <ChatView
            environmentId={sessionRef.environmentId}
            sessionId={sessionRef.sessionId}
            onDiffPanelOpen={markDiffOpened}
            reserveTitleBarControlInset={!diffOpen}
            routeKind="server"
          />
        </AppMainSurface>
        <DiffPanelInlineSidebar
          diffOpen={diffOpen}
          onCloseDiff={closeDiff}
          onOpenDiff={openDiff}
          renderDiffContent={shouldRenderDiffContent}
        />
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
      <RightPanelSheet open={diffOpen} onClose={closeDiff}>
        {shouldRenderDiffContent ? <LazyDiffPanel mode="sheet" /> : null}
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
