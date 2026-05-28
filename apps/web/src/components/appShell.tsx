import { type ComponentPropsWithoutRef, type ReactNode } from "react";

import { isElectron } from "../env";
import { cn } from "../lib/utils";
import {
  COLLAPSED_TITLEBAR_SIDEBAR_TRIGGER_CLASS,
  useCollapsedTitlebarSidebarTriggerLayout,
} from "./sidebar/titlebarSidebarLayout";
import { SidebarInset, SidebarTrigger } from "./ui/sidebar";

export const APP_CONTENT_MAX_WIDTH_CLASS = "max-w-[46.8rem]";

export function AppMainSurface({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof SidebarInset>) {
  return (
    <SidebarInset
      className={cn(
        "h-svh min-h-0 overflow-hidden overscroll-y-none bg-white text-foreground md:h-dvh dark:bg-background",
        className,
      )}
      {...props}
    />
  );
}

export function AppTopBar({
  title,
  children,
  rightActions,
  reserveTitleBarControlInset = true,
  showSidebarTrigger = true,
  className,
  contentClassName,
  titleClassName,
  mainClassName,
  actionsClassName,
  ...headerProps
}: ComponentPropsWithoutRef<"header"> & {
  title?: ReactNode;
  children?: ReactNode;
  rightActions?: ReactNode;
  reserveTitleBarControlInset?: boolean | undefined;
  showSidebarTrigger?: boolean;
  contentClassName?: string;
  titleClassName?: string;
  mainClassName?: string;
  actionsClassName?: string;
}) {
  const collapsedTitlebarTriggerLayout = useCollapsedTitlebarSidebarTriggerLayout();

  return (
    <header
      className={cn(
        "relative z-20 shrink-0 bg-background/96 shadow-none after:pointer-events-none after:absolute after:inset-x-0 after:top-full after:h-5 after:bg-gradient-to-b after:from-background after:to-transparent after:content-['']",
        isElectron
          ? cn(
              "drag-region flex h-[52px] items-center px-3 sm:px-5 wco:h-[env(titlebar-area-height)]",
              reserveTitleBarControlInset &&
                "wco:pr-[calc(100vw-env(titlebar-area-width)-env(titlebar-area-x)+1em)]",
            )
          : "pb-1 pl-[calc(env(safe-area-inset-left)+0.75rem)] pr-[calc(env(safe-area-inset-right)+0.75rem)] pt-2 sm:pb-2 sm:pl-[calc(env(safe-area-inset-left)+1.25rem)] sm:pr-[calc(env(safe-area-inset-right)+1.25rem)] sm:pt-3",
        className,
      )}
      {...headerProps}
    >
      <div
        className={cn(
          "@container/header-actions relative flex min-w-0 flex-1 items-center gap-2",
          contentClassName,
        )}
      >
        {showSidebarTrigger &&
          collapsedTitlebarTriggerLayout.shouldShowCollapsedTitlebarTrigger && (
            <SidebarTrigger
              className={cn(
                COLLAPSED_TITLEBAR_SIDEBAR_TRIGGER_CLASS,
                collapsedTitlebarTriggerLayout.triggerOffsetClassName,
              )}
            />
          )}
        <div
          className={cn(
            "flex min-w-0 flex-1 items-center gap-2 overflow-hidden sm:gap-3",
            showSidebarTrigger && collapsedTitlebarTriggerLayout.contentOffsetClassName,
            mainClassName,
          )}
        >
          {showSidebarTrigger && (
            <SidebarTrigger
              className={cn(
                "shrink-0",
                collapsedTitlebarTriggerLayout.shouldShowCollapsedTitlebarTrigger
                  ? "hidden"
                  : "size-7 md:hidden",
              )}
            />
          )}
          {children ??
            (title ? (
              <span
                className={cn(
                  "min-w-0 truncate text-sm font-medium text-foreground",
                  titleClassName,
                )}
              >
                {title}
              </span>
            ) : null)}
        </div>
        {rightActions ? (
          <div className={cn("flex shrink-0 items-center justify-end gap-2", actionsClassName)}>
            {rightActions}
          </div>
        ) : null}
      </div>
    </header>
  );
}
