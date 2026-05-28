import { isElectron } from "~/env";
import { useDesktopWindowChromeState } from "~/hooks/useDesktopWindowChromeState";
import { isMacPlatform } from "~/lib/utils";

import { useSidebar } from "../ui/sidebar";

export const COLLAPSED_TITLEBAR_SIDEBAR_TRIGGER_CLASS =
  "absolute top-1/2 z-20 size-6 -translate-y-1/2 shrink-0 rounded-md p-0 before:rounded-[calc(var(--radius-md)-1px)] hover:bg-accent/70 data-[pressed]:bg-accent/70 [&_svg]:size-4";

export function useDesktopTitlebarLayout() {
  const windowChromeState = useDesktopWindowChromeState();
  const hasDesktopTitlebarChrome = isElectron && !windowChromeState.isFullScreen;
  const hasMacTitlebarControls =
    hasDesktopTitlebarChrome &&
    typeof navigator !== "undefined" &&
    isMacPlatform(navigator.platform);

  return {
    hasDesktopTitlebarChrome,
    hasMacTitlebarControls,
  };
}

export function useCollapsedTitlebarSidebarTriggerLayout() {
  const { isMobile, state: sidebarState } = useSidebar();
  const { hasDesktopTitlebarChrome, hasMacTitlebarControls } = useDesktopTitlebarLayout();
  const shouldShowCollapsedTitlebarTrigger = !isMobile && sidebarState === "collapsed";

  return {
    contentOffsetClassName: shouldShowCollapsedTitlebarTrigger
      ? hasMacTitlebarControls
        ? "pl-[6.75rem]"
        : "pl-8"
      : null,
    shouldShowCollapsedTitlebarTrigger,
    triggerOffsetClassName:
      hasDesktopTitlebarChrome && hasMacTitlebarControls ? "left-[4.25rem]" : "left-0",
  };
}
