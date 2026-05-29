import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "./ui/empty";
import { AppMainSurface, AppTopBar } from "./appShell";

export function NoActiveSessionState() {
  return (
    <AppMainSurface className="h-dvh">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden bg-white dark:bg-background">
        <AppTopBar title="No active session" />

        <Empty className="flex-1">
          <div className="w-full max-w-lg rounded-3xl border border-border/55 bg-card/40 px-8 py-12 shadow-sm/5">
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
    </AppMainSurface>
  );
}
