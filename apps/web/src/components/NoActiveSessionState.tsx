import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "./ui/empty";
import { SidebarInset, SidebarTrigger } from "./ui/sidebar";
import { isElectron } from "../env";
import { cn } from "~/lib/utils";
import {
  COLLAPSED_TITLEBAR_SIDEBAR_TRIGGER_CLASS,
  useCollapsedTitlebarSidebarTriggerLayout,
} from "./sidebar/titlebarSidebarLayout";

export function NoActiveSessionState() {
  const collapsedTitlebarTriggerLayout = useCollapsedTitlebarSidebarTriggerLayout();

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-white text-foreground dark:bg-background">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden bg-white dark:bg-background">
        <header
          className={cn(
            "border-b border-border bg-background/96 px-3 shadow-depth-header sm:px-5",
            isElectron
              ? "drag-region flex h-[52px] items-center wco:h-[env(titlebar-area-height)]"
              : "py-2 sm:py-3",
          )}
        >
          {isElectron ? (
            <div
              className={cn(
                "relative flex min-w-0 items-center gap-2 overflow-hidden",
                collapsedTitlebarTriggerLayout.contentOffsetClassName,
                "wco:pr-[calc(100vw-env(titlebar-area-width)-env(titlebar-area-x)+1em)]",
              )}
            >
              {collapsedTitlebarTriggerLayout.shouldShowCollapsedTitlebarTrigger && (
                <SidebarTrigger
                  className={cn(
                    COLLAPSED_TITLEBAR_SIDEBAR_TRIGGER_CLASS,
                    collapsedTitlebarTriggerLayout.triggerOffsetClassName,
                  )}
                />
              )}
              <SidebarTrigger
                className={cn(
                  "shrink-0",
                  collapsedTitlebarTriggerLayout.shouldShowCollapsedTitlebarTrigger
                    ? "hidden"
                    : "size-7 md:hidden",
                )}
              />
              <span className="truncate text-xs text-muted-foreground/50">No active session</span>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <SidebarTrigger className="size-7 shrink-0 md:hidden" />
              <span className="text-sm font-medium text-foreground md:text-muted-foreground/60">
                No active session
              </span>
            </div>
          )}
        </header>

        <Empty className="flex-1">
          <div className="w-full max-w-lg rounded-3xl border border-border/55 bg-card/40 px-8 py-12 shadow-depth-card">
            <EmptyHeader className="max-w-none">
              <EmptyTitle className="text-foreground text-xl">
                Pick a session to continue
              </EmptyTitle>
              <EmptyDescription className="mt-2 text-sm text-muted-foreground/78">
                Select an existing session or create a new one to get started.
              </EmptyDescription>
            </EmptyHeader>
          </div>
        </Empty>
      </div>
    </SidebarInset>
  );
}
