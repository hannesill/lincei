import type { EnvironmentId } from "@t3tools/contracts";
import { Globe } from "lucide-react";

import { Empty, EmptyDescription, EmptyMedia, EmptyTitle } from "~/components/ui/empty";

import { PreviewLocalServerCard } from "./PreviewLocalServerCard";
import { useDiscoveredLocalServers } from "./useDiscoveredLocalServers";

export function PreviewEmptyState(props: {
  environmentId: EnvironmentId;
  configuredUrls?: ReadonlyArray<string> | undefined;
  recentlySeenUrls?: ReadonlyArray<string> | undefined;
  onOpenUrl: (url: string) => void;
}) {
  const servers = useDiscoveredLocalServers(props);
  if (servers.length === 0) {
    return (
      <Empty>
        <EmptyMedia variant="icon">
          <Globe className="size-4.5 text-muted-foreground" />
        </EmptyMedia>
        <EmptyTitle>No preview yet</EmptyTitle>
        <EmptyDescription>
          Type a URL above, or run a study action. Listening localhost ports appear here
          automatically.
        </EmptyDescription>
      </Empty>
    );
  }
  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto">
      <h2 className="px-4 pb-1.5 pt-4 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/80">
        Local
      </h2>
      <div className="flex flex-col gap-1.5 px-3 pb-4">
        {servers.map((server) => (
          <PreviewLocalServerCard
            key={`${server.host}:${server.port}`}
            server={server}
            onOpen={() => props.onOpenUrl(server.url)}
          />
        ))}
      </div>
    </div>
  );
}
