import type { ScopedSessionRef } from "@t3tools/contracts";
import { Suspense, lazy, useCallback, useEffect, useRef, type ReactNode } from "react";

import { DiffWorkerPoolProvider } from "./DiffWorkerPoolProvider";
import {
  DiffPanelHeaderSkeleton,
  DiffPanelLoadingState,
  DiffPanelShell,
  type DiffPanelMode,
} from "./DiffPanelShell";
import { Sidebar, SidebarProvider, SidebarRail } from "./ui/sidebar";

const DiffPanel = lazy(() => import("./DiffPanel"));
const PreviewPanel = lazy(() =>
  import("./preview/PreviewPanel").then((module) => ({ default: module.PreviewPanel })),
);

const DIFF_INLINE_SIDEBAR_WIDTH_STORAGE_KEY = "chat_diff_sidebar_width";
const DIFF_INLINE_DEFAULT_WIDTH = "clamp(24rem,34vw,36rem)";
const DIFF_INLINE_SIDEBAR_MIN_WIDTH = 22 * 16;
const DIFF_INLINE_SIDEBAR_MAX_WIDTH = 256 * 16;
const DIFF_INLINE_CHAT_MIN_WIDTH = 22.5 * 16;
const COMPOSER_COMPACT_MIN_LEFT_CONTROLS_WIDTH_PX = 208;

const DiffLoadingFallback = (props: { mode: DiffPanelMode }) => {
  return (
    <DiffPanelShell mode={props.mode} header={<DiffPanelHeaderSkeleton />}>
      <DiffPanelLoadingState label="Loading diff viewer..." />
    </DiffPanelShell>
  );
};

export const LazyDiffPanel = (props: { mode: DiffPanelMode }) => {
  return (
    <DiffWorkerPoolProvider>
      <Suspense fallback={<DiffLoadingFallback mode={props.mode} />}>
        <DiffPanel mode={props.mode} />
      </Suspense>
    </DiffWorkerPoolProvider>
  );
};

export const LazyPreviewPanel = (props: {
  mode: "sidebar" | "sheet";
  sessionRef: ScopedSessionRef;
  configuredUrls?: ReadonlyArray<string> | undefined;
  onClosePanel: () => void;
}) => (
  <Suspense fallback={<DiffLoadingFallback mode={props.mode} />}>
    <PreviewPanel {...props} />
  </Suspense>
);

export const RightPanelInlineSidebar = (props: {
  open: boolean;
  onClose: () => void;
  onOpen: () => void;
  children: ReactNode;
}) => {
  const { open, onClose, onOpen, children } = props;
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const onOpenChange = useCallback(
    (open: boolean) => {
      if (open) {
        onOpen();
        return;
      }
      onClose();
    },
    [onClose, onOpen],
  );
  const shouldAcceptInlineSidebarWidth = useCallback(
    ({ nextWidth, wrapper }: { nextWidth: number; wrapper: HTMLElement }) => {
      const layoutContainer = wrapper.parentElement;
      const maxSidebarWidth = layoutContainer
        ? Math.max(
            DIFF_INLINE_SIDEBAR_MIN_WIDTH,
            layoutContainer.clientWidth - DIFF_INLINE_CHAT_MIN_WIDTH,
          )
        : DIFF_INLINE_SIDEBAR_MAX_WIDTH;
      if (nextWidth > maxSidebarWidth) {
        return false;
      }

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

  useEffect(() => {
    if (!open) {
      return;
    }

    const wrapper = wrapperRef.current;
    if (!wrapper) {
      return;
    }

    const clampSidebarWidth = () => {
      const layoutContainer = wrapper.parentElement;
      const sidebarContainer = wrapper.querySelector<HTMLElement>(
        "[data-slot='sidebar-container']",
      );
      if (!layoutContainer || !sidebarContainer) {
        return;
      }

      const maxSidebarWidth = Math.max(
        DIFF_INLINE_SIDEBAR_MIN_WIDTH,
        layoutContainer.clientWidth - DIFF_INLINE_CHAT_MIN_WIDTH,
      );
      const currentWidth = sidebarContainer.getBoundingClientRect().width;
      const nextWidth = Math.min(currentWidth, maxSidebarWidth, DIFF_INLINE_SIDEBAR_MAX_WIDTH);
      if (currentWidth > nextWidth + 0.5) {
        wrapper.style.setProperty("--sidebar-width", `${nextWidth}px`);
      }
    };

    clampSidebarWidth();
    window.addEventListener("resize", clampSidebarWidth);
    return () => {
      window.removeEventListener("resize", clampSidebarWidth);
    };
  }, [open]);

  return (
    <SidebarProvider
      defaultOpen={false}
      open={open}
      onOpenChange={onOpenChange}
      className="w-auto min-h-0 flex-none bg-transparent"
      ref={wrapperRef}
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
        {children}
        <SidebarRail />
      </Sidebar>
    </SidebarProvider>
  );
};
