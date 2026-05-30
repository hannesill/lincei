import {
  CommandId,
  type EnvironmentId,
  type OrchestrationResearchCard,
  type ResearchCardReviewResponse,
  type SessionId,
} from "@t3tools/contracts";
import {
  CheckIcon,
  CircleSlashIcon,
  PanelRightCloseIcon,
  RotateCcwIcon,
  XIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { memo, useCallback, useMemo, useState } from "react";

import { readEnvironmentApi } from "../environmentApi";
import { cn } from "../lib/utils";
import ChatMarkdown from "./ChatMarkdown";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { ScrollArea } from "./ui/scroll-area";
import { Switch } from "./ui/switch";
import { stackedSessionToast, toastManager } from "./ui/toast";

interface ResearchCardDrawerProps {
  cards: ReadonlyArray<OrchestrationResearchCard>;
  environmentId: EnvironmentId;
  sessionId: SessionId;
  markdownCwd: string | undefined;
  mode?: "sheet" | "sidebar";
  onClose: () => void;
}

const terminalStatuses = new Set(["dismissed", "rejected", "superseded"]);

function isActiveCard(card: OrchestrationResearchCard): boolean {
  return !terminalStatuses.has(card.status);
}

function statusLabel(status: OrchestrationResearchCard["status"]): string {
  return status.replaceAll("-", " ");
}

function previewMarkdown(card: OrchestrationResearchCard): string | null {
  const preview = card.preview;
  if (typeof preview === "string") {
    return preview;
  }
  if (typeof preview === "object" && preview !== null) {
    const markdown = (preview as Record<string, unknown>).markdown;
    if (typeof markdown === "string") {
      return markdown;
    }
  }
  return null;
}

function makeReviewResponse(action: string): ResearchCardReviewResponse {
  return {
    action,
    timestamp: new Date().toISOString(),
  };
}

const ReviewButton = (props: {
  icon: ReactNode;
  label: string;
  disabled: boolean;
  onClick: () => void;
}) => (
  <Button
    size="xs"
    variant="outline"
    type="button"
    disabled={props.disabled}
    onClick={props.onClick}
    className="h-7 gap-1.5 px-2 text-[11px]"
  >
    {props.icon}
    {props.label}
  </Button>
);

const ResearchCardDrawer = memo(function ResearchCardDrawer({
  cards,
  environmentId,
  sessionId,
  markdownCwd,
  mode = "sidebar",
  onClose,
}: ResearchCardDrawerProps) {
  const [showAll, setShowAll] = useState(false);
  const [respondingCardIds, setRespondingCardIds] = useState<ReadonlySet<string>>(new Set());
  const visibleCards = useMemo(
    () => (showAll ? [...cards] : cards.filter(isActiveCard)),
    [cards, showAll],
  );

  const reviewCard = useCallback(
    (card: OrchestrationResearchCard, action: string) => {
      const api = readEnvironmentApi(environmentId);
      if (!api) return;
      setRespondingCardIds((previous) => new Set(previous).add(card.id));
      void api.orchestration
        .dispatchCommand({
          type: "session.research-card.review",
          commandId: CommandId.make(crypto.randomUUID()),
          sessionId,
          cardId: card.id,
          response: makeReviewResponse(action),
          createdAt: new Date().toISOString(),
        })
        .catch((error) => {
          toastManager.add(
            stackedSessionToast({
              type: "error",
              title: "Could not review card",
              description: error instanceof Error ? error.message : "An error occurred.",
            }),
          );
        })
        .finally(() => {
          setRespondingCardIds((previous) => {
            const next = new Set(previous);
            next.delete(card.id);
            return next;
          });
        });
    },
    [environmentId, sessionId],
  );

  return (
    <div
      className={cn(
        "flex min-h-0 flex-col bg-card/50",
        mode === "sidebar"
          ? "h-full w-[360px] shrink-0 border-l border-border/70"
          : "h-full w-full",
      )}
    >
      <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-border/60 px-3">
        <div className="flex min-w-0 items-center gap-2">
          <Badge
            variant="secondary"
            className="rounded-md bg-emerald-500/10 px-1.5 py-0 text-[10px] font-semibold tracking-wide text-emerald-500 uppercase"
          >
            Cards
          </Badge>
          <span className="text-[11px] text-muted-foreground/60">
            {cards.filter(isActiveCard).length} active
          </span>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground/70">
            All
            <Switch checked={showAll} onCheckedChange={(checked) => setShowAll(Boolean(checked))} />
          </label>
          <Button
            size="icon-xs"
            variant="ghost"
            onClick={onClose}
            aria-label="Close research card drawer"
            className="text-muted-foreground/50 hover:text-foreground/70"
          >
            <PanelRightCloseIcon className="size-3.5" />
          </Button>
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-3 p-3">
          {visibleCards.length === 0 ? (
            <div className="rounded-md border border-dashed border-border/70 px-3 py-8 text-center text-sm text-muted-foreground/70">
              No research cards.
            </div>
          ) : (
            visibleCards.map((card) => {
              const markdown = previewMarkdown(card);
              const isResponding = respondingCardIds.has(card.id);
              return (
                <article
                  key={card.id}
                  className="rounded-md border border-border/70 bg-background/60 p-3 shadow-sm/5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="truncate text-sm font-medium text-foreground">{card.title}</h3>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <Badge variant="outline" className="rounded-md px-1.5 py-0 text-[10px]">
                          {statusLabel(card.status)}
                        </Badge>
                        <span className="text-[10px] text-muted-foreground/50">{card.type}</span>
                      </div>
                    </div>
                  </div>

                  {markdown ? (
                    <div className="mt-3 rounded-md border border-border/50 bg-card/35 p-2.5 text-[13px]">
                      <ChatMarkdown text={markdown} cwd={markdownCwd} isStreaming={false} />
                    </div>
                  ) : null}

                  {card.artifacts.length > 0 ? (
                    <div className="mt-3 space-y-1">
                      {card.artifacts.map((artifact) => (
                        <div
                          key={artifact.id}
                          className="truncate text-[11px] text-muted-foreground/70"
                          title={artifact.path ?? artifact.uri ?? artifact.id}
                        >
                          {artifact.kind}:{" "}
                          {artifact.label ?? artifact.path ?? artifact.uri ?? artifact.id}
                        </div>
                      ))}
                    </div>
                  ) : null}

                  <div className="mt-3 flex flex-wrap gap-1.5">
                    <ReviewButton
                      icon={<CheckIcon className="size-3" />}
                      label="Accept"
                      disabled={isResponding}
                      onClick={() => reviewCard(card, "accept")}
                    />
                    <ReviewButton
                      icon={<RotateCcwIcon className="size-3" />}
                      label="Changes"
                      disabled={isResponding}
                      onClick={() => reviewCard(card, "request_changes")}
                    />
                    <ReviewButton
                      icon={<XIcon className="size-3" />}
                      label="Reject"
                      disabled={isResponding}
                      onClick={() => reviewCard(card, "reject")}
                    />
                    <ReviewButton
                      icon={<CircleSlashIcon className="size-3" />}
                      label="Dismiss"
                      disabled={isResponding}
                      onClick={() => reviewCard(card, "dismiss")}
                    />
                  </div>
                </article>
              );
            })
          )}
        </div>
      </ScrollArea>
    </div>
  );
});

export default ResearchCardDrawer;
