import { useParams } from "@tanstack/react-router";
import { scopeProjectRef } from "@t3tools/client-runtime";
import { isActiveResearchCard } from "@t3tools/shared/researchCards";
import type { TimestampFormat } from "@t3tools/contracts/settings";
import { LayersIcon } from "lucide-react";
import { useMemo } from "react";

import { resolveSessionRouteRef } from "../sessionRoutes";
import { selectProjectByRef, useStore } from "../store";
import { createSessionSelectorByRef } from "../storeSelectors";
import { formatShortTimestamp } from "../timestampFormat";
import type { ResearchCard } from "../types";
import { useSettings } from "../hooks/useSettings";
import ChatMarkdown from "./ChatMarkdown";
import { DiffPanelShell, type DiffPanelMode } from "./DiffPanelShell";
import { Badge } from "./ui/badge";

interface ResearchCardsPanelProps {
  mode?: DiffPanelMode;
}

function formatResearchCardLabel(value: string): string {
  return value
    .split("-")
    .map((part) => (part.length > 0 ? `${part[0]?.toUpperCase()}${part.slice(1)}` : part))
    .join(" ");
}

function getStatusBadgeVariant(status: ResearchCard["status"]) {
  switch (status) {
    case "proposed":
      return "info" as const;
    case "review-requested":
      return "default" as const;
    case "changes-requested":
      return "warning" as const;
    case "accepted":
      return "success" as const;
    case "rejected":
    case "withdrawn":
    case "superseded":
    case "dismissed":
      return "outline" as const;
  }
}

function compareResearchCards(left: ResearchCard, right: ResearchCard): number {
  const leftActive = isActiveResearchCard(left);
  const rightActive = isActiveResearchCard(right);
  if (leftActive !== rightActive) {
    return leftActive ? -1 : 1;
  }
  return right.updatedAt.localeCompare(left.updatedAt) || left.title.localeCompare(right.title);
}

function PreviewContent(props: { card: ResearchCard; cwd: string | undefined }) {
  if (props.card.preview === undefined) {
    return <p className="text-xs text-muted-foreground/55">No preview</p>;
  }

  if (typeof props.card.preview === "string") {
    const preview = props.card.preview.trim();
    if (preview.length === 0) {
      return <p className="text-xs text-muted-foreground/55">No preview</p>;
    }
    return (
      <div className="research-card-markdown text-sm leading-6">
        <ChatMarkdown text={preview} cwd={props.cwd} isStreaming={false} />
      </div>
    );
  }

  let jsonPreview: string;
  try {
    jsonPreview = JSON.stringify(props.card.preview, null, 2) ?? String(props.card.preview);
  } catch {
    jsonPreview = String(props.card.preview);
  }

  return (
    <pre className="max-h-64 overflow-auto rounded-md border border-border/70 bg-background/70 p-3 font-mono text-[11px] leading-relaxed text-muted-foreground/90">
      {jsonPreview}
    </pre>
  );
}

function ArtifactReferences(props: { artifacts: ResearchCard["artifacts"] }) {
  if (props.artifacts.length === 0) {
    return null;
  }

  return (
    <div className="space-y-1.5">
      {props.artifacts.map((artifact) => {
        const label = artifact.label ?? artifact.path ?? artifact.uri ?? artifact.id;
        const detail = artifact.path ?? artifact.uri ?? artifact.mimeType ?? artifact.id;
        return (
          <div
            key={artifact.id}
            className="rounded-md border border-border/60 bg-background/50 px-2.5 py-2"
          >
            <div className="flex items-center gap-2">
              <Badge variant="outline" size="sm">
                {artifact.kind}
              </Badge>
              <span className="min-w-0 truncate text-xs font-medium text-foreground/85">
                {label}
              </span>
            </div>
            {detail !== label ? (
              <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground/60">
                {detail}
              </p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function ReviewMetadata(props: { review: ResearchCard["review"] }) {
  if (!props.review) {
    return null;
  }

  const responseText =
    props.review.response?.summary ??
    props.review.response?.message ??
    props.review.response?.action ??
    null;

  return (
    <div className="space-y-2 rounded-md border border-border/60 bg-background/45 px-3 py-2.5">
      <div>
        <div className="text-[10px] font-semibold tracking-wide text-muted-foreground/60 uppercase">
          Review prompt
        </div>
        <p className="mt-1 text-xs leading-5 text-foreground/80">{props.review.prompt}</p>
      </div>
      {responseText ? (
        <div>
          <div className="text-[10px] font-semibold tracking-wide text-muted-foreground/60 uppercase">
            Review response
          </div>
          <p className="mt-1 text-xs leading-5 text-foreground/80">{responseText}</p>
        </div>
      ) : null}
    </div>
  );
}

function ResearchCardItem(props: {
  card: ResearchCard;
  cwd: string | undefined;
  timestampFormat: TimestampFormat;
}) {
  const artifactCount = props.card.artifacts.length;
  return (
    <article className="rounded-md border border-border/70 bg-card/70 p-3 shadow-xs">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-foreground" title={props.card.title}>
            {props.card.title}
          </h3>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <Badge variant="secondary" size="sm">
              {formatResearchCardLabel(props.card.type)}
            </Badge>
            <Badge variant={getStatusBadgeVariant(props.card.status)} size="sm">
              {formatResearchCardLabel(props.card.status)}
            </Badge>
          </div>
        </div>
        <div className="shrink-0 text-right text-[11px] text-muted-foreground/65">
          <div>{formatShortTimestamp(props.card.updatedAt, props.timestampFormat)}</div>
          <div className="mt-0.5">
            {artifactCount} {artifactCount === 1 ? "artifact" : "artifacts"}
          </div>
        </div>
      </div>
      <div className="mt-3 space-y-3">
        <PreviewContent card={props.card} cwd={props.cwd} />
        <ArtifactReferences artifacts={props.card.artifacts} />
        <ReviewMetadata review={props.card.review} />
      </div>
    </article>
  );
}

export default function ResearchCardsPanel({ mode = "inline" }: ResearchCardsPanelProps) {
  const settings = useSettings();
  const routeSessionRef = useParams({
    strict: false,
    select: (params) => resolveSessionRouteRef(params),
  });
  const activeSession = useStore(
    useMemo(() => createSessionSelectorByRef(routeSessionRef), [routeSessionRef]),
  );
  const activeProject = useStore((store) =>
    activeSession
      ? selectProjectByRef(
          store,
          scopeProjectRef(activeSession.environmentId, activeSession.projectId),
        )
      : undefined,
  );
  const orderedCards = useMemo(
    () => (activeSession?.researchCards ?? []).toSorted(compareResearchCards),
    [activeSession?.researchCards],
  );
  const activeCwd = activeSession?.worktreePath ?? activeProject?.cwd;
  const header = (
    <div className="flex min-w-0 flex-1 items-center gap-2 [-webkit-app-region:no-drag]">
      <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-md border border-border/70 bg-background/70 text-muted-foreground">
        <LayersIcon className="size-3.5" />
      </span>
      <div className="min-w-0">
        <div className="truncate text-sm font-medium text-foreground">Research cards</div>
        <div className="text-[11px] text-muted-foreground/65">
          {orderedCards.length} {orderedCards.length === 1 ? "card" : "cards"}
        </div>
      </div>
    </div>
  );

  return (
    <DiffPanelShell mode={mode} header={header}>
      {!activeSession ? (
        <div className="flex flex-1 items-center justify-center px-5 text-center text-xs text-muted-foreground/70">
          Select a session to inspect research cards.
        </div>
      ) : orderedCards.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-5 text-center text-xs text-muted-foreground/70">
          No research cards yet.
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto p-3">
          <div className="space-y-3">
            {orderedCards.map((card) => (
              <ResearchCardItem
                key={card.id}
                card={card}
                cwd={activeCwd}
                timestampFormat={settings.timestampFormat}
              />
            ))}
          </div>
        </div>
      )}
    </DiffPanelShell>
  );
}
