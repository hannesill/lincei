import { cn } from "~/lib/utils";

import { BrowserMockup } from "./BrowserMockup";
import type { PreviewableServer } from "./useDiscoveredLocalServers";

export function PreviewLocalServerCard(props: { server: PreviewableServer; onOpen: () => void }) {
  const { server, onOpen } = props;
  const subtitle = server.processName
    ? server.processName
    : server.listening
      ? "Listening"
      : server.source === "configured"
        ? "Configured"
        : "Recently seen";
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "group flex w-full items-center gap-3 rounded-xl border border-border/70 bg-card px-3 py-2.5 text-left transition-colors",
        "hover:border-border hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      )}
    >
      <BrowserMockup className="size-7 shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium text-foreground">
          {server.host}:{server.port}
        </span>
        <span className="truncate text-xs text-muted-foreground">{subtitle}</span>
      </div>
      <span
        aria-label={server.listening ? "Listening" : "Not currently listening"}
        className={cn(
          "size-2 shrink-0 rounded-full",
          server.listening ? "bg-success" : "bg-muted-foreground/40",
        )}
      />
    </button>
  );
}
