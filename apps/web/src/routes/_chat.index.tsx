import { createFileRoute } from "@tanstack/react-router";
import { LinkIcon, PlusIcon } from "lucide-react";

import { AppMainSurface, AppTopBar } from "../components/appShell";
import { NoActiveSessionState } from "../components/NoActiveSessionState";
import { Button } from "../components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../components/ui/empty";
import { useSavedEnvironmentRegistryStore } from "../environments/runtime";
import { APP_DISPLAY_NAME } from "~/branding";

function ChatIndexRouteView() {
  const { authGateState } = Route.useRouteContext();
  const savedEnvironmentCount = useSavedEnvironmentRegistryStore(
    (state) => Object.keys(state.byId).length,
  );

  if (authGateState.status === "hosted-static" && savedEnvironmentCount === 0) {
    return <HostedStaticOnboardingState />;
  }

  return <NoActiveSessionState />;
}

export const Route = createFileRoute("/_chat/")({
  component: ChatIndexRouteView,
});

function HostedStaticOnboardingState() {
  return (
    <AppMainSurface className="h-dvh">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden bg-white dark:bg-background">
        <AppTopBar title={APP_DISPLAY_NAME} />

        <Empty className="flex-1">
          <div className="w-full max-w-xl rounded-3xl border border-border/55 bg-card/40 px-8 py-12 shadow-sm/5">
            <EmptyHeader className="max-w-none">
              <div className="mx-auto mb-5 flex size-11 items-center justify-center rounded-xl border border-border/70 bg-background/70 text-muted-foreground">
                <LinkIcon className="size-5" />
              </div>
              <EmptyTitle className="text-foreground text-xl">
                Connect an environment to get started
              </EmptyTitle>
              <EmptyDescription className="mt-2 text-sm leading-relaxed text-muted-foreground/78">
                Open a pairing link from your Lincei desktop app or add a reachable backend
                manually. Your saved environments stay in this browser.
              </EmptyDescription>
              <div className="mt-6 flex justify-center">
                <Button render={<a href="/settings/connections" />} size="sm">
                  <PlusIcon className="size-4" />
                  Add environment
                </Button>
              </div>
            </EmptyHeader>
          </div>
        </Empty>
      </div>
    </AppMainSurface>
  );
}
