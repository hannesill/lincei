import { useParams } from "@tanstack/react-router";
import { scopeProjectRef } from "@t3tools/client-runtime";
import { isActiveResearchCard } from "@t3tools/shared/researchCards";
import type { TimestampFormat } from "@t3tools/contracts/settings";
import type {
  ResearchCardDependency,
  ResearchCardDependencyStatus,
  ResearchCardManifest,
  ResearchArtifactId,
} from "@t3tools/contracts/researchStudy";
import {
  BarChart3Icon,
  CheckSquareIcon,
  DatabaseIcon,
  ExternalLinkIcon,
  EyeIcon,
  FileTextIcon,
  ImageIcon,
  KeyRoundIcon,
  LayersIcon,
  Table2Icon,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";

import { resolveAndPersistPreferredEditor } from "../editorPreferences";
import { ensureEnvironmentApi } from "../environmentApi";
import { ensureLocalApi } from "../localApi";
import { resolveSessionRouteRef } from "../sessionRoutes";
import { selectProjectByRef, selectSessionsAcrossEnvironments, useStore } from "../store";
import { createSessionSelectorByRef } from "../storeSelectors";
import { formatShortTimestamp } from "../timestampFormat";
import type { ResearchCard, Session } from "../types";
import { useSettings } from "../hooks/useSettings";
import { cn } from "../lib/utils";
import ChatMarkdown from "./ChatMarkdown";
import { DiffPanelShell, type DiffPanelMode } from "./DiffPanelShell";
import { loadResearchArtifactPreview } from "./ResearchCardsPanel.logic";
import { Badge } from "./ui/badge";
import { Toggle, ToggleGroup } from "./ui/toggle-group";

interface ResearchCardsPanelProps {
  mode?: DiffPanelMode;
}

type ResearchCardScope = "session" | "study";

interface ScopedResearchCard {
  card: ResearchCard;
  cwd: string | undefined;
  environmentId: Session["environmentId"];
  sessionId: Session["id"];
  sessionTitle: string;
}

interface ResearchCardTypePresentation {
  label: string;
  Icon: LucideIcon;
  shellClassName: string;
  headerClassName: string;
  iconClassName: string;
}

const CARD_TYPE_PRESENTATION = {
  markdown: {
    label: "Narrative",
    Icon: FileTextIcon,
    shellClassName: "border-sky-200/80 dark:border-sky-400/20",
    headerClassName: "bg-sky-50/80 dark:bg-sky-500/10",
    iconClassName:
      "border-sky-200 bg-sky-100 text-sky-700 dark:border-sky-400/20 dark:bg-sky-400/12 dark:text-sky-200",
  },
  table: {
    label: "Cohort table",
    Icon: Table2Icon,
    shellClassName: "border-teal-200/80 dark:border-teal-400/20",
    headerClassName: "bg-teal-50/80 dark:bg-teal-500/10",
    iconClassName:
      "border-teal-200 bg-teal-100 text-teal-700 dark:border-teal-400/20 dark:bg-teal-400/12 dark:text-teal-200",
  },
  keyValue: {
    label: "Measures",
    Icon: KeyRoundIcon,
    shellClassName: "border-amber-200/85 dark:border-amber-400/20",
    headerClassName: "bg-amber-50/85 dark:bg-amber-500/10",
    iconClassName:
      "border-amber-200 bg-amber-100 text-amber-800 dark:border-amber-400/20 dark:bg-amber-400/12 dark:text-amber-200",
  },
  chart: {
    label: "Analysis view",
    Icon: BarChart3Icon,
    shellClassName: "border-indigo-200/80 dark:border-indigo-400/20",
    headerClassName: "bg-indigo-50/80 dark:bg-indigo-500/10",
    iconClassName:
      "border-indigo-200 bg-indigo-100 text-indigo-700 dark:border-indigo-400/20 dark:bg-indigo-400/12 dark:text-indigo-200",
  },
  image: {
    label: "Figure",
    Icon: ImageIcon,
    shellClassName: "border-cyan-200/80 dark:border-cyan-400/20",
    headerClassName: "bg-cyan-50/80 dark:bg-cyan-500/10",
    iconClassName:
      "border-cyan-200 bg-cyan-100 text-cyan-700 dark:border-cyan-400/20 dark:bg-cyan-400/12 dark:text-cyan-200",
  },
  decision: {
    label: "Review gate",
    Icon: CheckSquareIcon,
    shellClassName: "border-rose-200/90 dark:border-rose-400/20",
    headerClassName: "bg-rose-50/85 dark:bg-rose-500/10",
    iconClassName:
      "border-rose-200 bg-rose-100 text-rose-700 dark:border-rose-400/20 dark:bg-rose-400/12 dark:text-rose-200",
  },
} satisfies Record<ResearchCard["type"], ResearchCardTypePresentation>;

interface NormalizedTablePreview {
  columns: string[];
  rows: Array<Record<string, unknown>>;
  totalRows: number;
  totalColumns: number;
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

function compareResearchCards(left: ScopedResearchCard, right: ScopedResearchCard): number {
  const leftActive = isActiveResearchCard(left.card);
  const rightActive = isActiveResearchCard(right.card);
  if (leftActive !== rightActive) {
    return leftActive ? -1 : 1;
  }
  return (
    right.card.updatedAt.localeCompare(left.card.updatedAt) ||
    left.card.title.localeCompare(right.card.title) ||
    left.sessionTitle.localeCompare(right.sessionTitle)
  );
}

function cardCwd(session: Session, projectCwd: string | undefined): string | undefined {
  return session.worktreePath ?? projectCwd;
}

function sessionScopedCards(
  session: Session | undefined,
  projectCwd: string | undefined,
): ScopedResearchCard[] {
  if (!session) {
    return [];
  }
  return session.researchCards.map((card) => ({
    card,
    cwd: cardCwd(session, projectCwd),
    environmentId: session.environmentId,
    sessionId: session.id,
    sessionTitle: session.title,
  }));
}

function studyScopedCards(input: {
  readonly activeSession: Session | undefined;
  readonly sessions: ReadonlyArray<Session>;
  readonly projectCwd: string | undefined;
}): ScopedResearchCard[] {
  if (!input.activeSession) {
    return [];
  }

  const byCardId = new Map<string, ScopedResearchCard>();
  for (const session of input.sessions) {
    if (
      session.environmentId !== input.activeSession.environmentId ||
      session.projectId !== input.activeSession.projectId
    ) {
      continue;
    }

    for (const card of session.researchCards) {
      const nextCard = {
        card,
        cwd: cardCwd(session, input.projectCwd),
        environmentId: session.environmentId,
        sessionId: session.id,
        sessionTitle: session.title,
      };
      const existingCard = byCardId.get(card.id);
      if (!existingCard || card.updatedAt.localeCompare(existingCard.card.updatedAt) > 0) {
        byCardId.set(card.id, nextCard);
      }
    }
  }

  return [...byCardId.values()];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRecordArray(value: unknown): value is Array<Record<string, unknown>> {
  return Array.isArray(value) && value.length > 0 && value.every(isRecord);
}

function getStringValue(
  record: Record<string, unknown>,
  keys: ReadonlyArray<string>,
): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }
  return null;
}

function formatPreviewCell(value: unknown): string {
  if (value === null) {
    return "null";
  }
  if (value === undefined) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function normalizeTablePreview(value: unknown): NormalizedTablePreview | null {
  if (isRecordArray(value)) {
    const columns = Array.from(new Set(value.flatMap((row) => Object.keys(row))));
    return {
      columns,
      rows: value,
      totalRows: value.length,
      totalColumns: columns.length,
    };
  }

  if (!isRecord(value) || !Array.isArray(value.columns)) {
    return null;
  }

  const columns = value.columns.map(formatPreviewCell).filter((column) => column.length > 0);
  const rawRows = Array.isArray(value.preview_rows)
    ? value.preview_rows
    : Array.isArray(value.rows)
      ? value.rows
      : null;
  if (columns.length === 0 || rawRows === null) {
    return null;
  }

  const rows = rawRows.map((row) => {
    if (Array.isArray(row)) {
      return Object.fromEntries(columns.map((column, index) => [column, row[index]]));
    }
    if (isRecord(row)) {
      return row;
    }
    return { value: row };
  });
  const shape = Array.isArray(value.shape) ? value.shape : null;
  const totalRows =
    typeof shape?.[0] === "number"
      ? shape[0]
      : typeof value.totalRows === "number"
        ? value.totalRows
        : rows.length;
  const totalColumns =
    typeof shape?.[1] === "number"
      ? shape[1]
      : typeof value.totalColumns === "number"
        ? value.totalColumns
        : columns.length;

  return { columns, rows, totalRows, totalColumns };
}

function StructuredTablePreview(props: { table: NormalizedTablePreview }) {
  const columns = props.table.columns.slice(0, 5);
  const rows = props.table.rows.slice(0, 5);
  if (columns.length === 0) {
    return <p className="text-xs text-muted-foreground/55">No preview</p>;
  }

  return (
    <div className="overflow-hidden rounded-md border border-border/60 bg-background/75 shadow-xs">
      <div className="max-h-64 overflow-auto">
        <table className="w-full min-w-0 border-separate border-spacing-0 text-left text-xs">
          <thead className="sticky top-0 z-10 bg-muted/60 text-[10px] font-semibold tracking-wide text-muted-foreground/70 uppercase backdrop-blur">
            <tr>
              {columns.map((column) => (
                <th key={column} className="border-b border-border/60 px-2.5 py-2">
                  <span className="line-clamp-1 break-all">{column}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={columns.map((column) => formatPreviewCell(row[column])).join("\u001f")}
                className="odd:bg-card/30"
              >
                {columns.map((column) => (
                  <td
                    key={column}
                    className="max-w-40 border-b border-border/35 px-2.5 py-2 align-top font-mono text-[11px] text-foreground/75 last:border-r-0"
                  >
                    <span className="line-clamp-2 break-words">
                      {formatPreviewCell(row[column])}
                    </span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {props.table.totalRows > rows.length || props.table.totalColumns > columns.length ? (
        <div className="border-t border-border/50 px-2.5 py-1.5 text-[11px] text-muted-foreground/65">
          Showing {rows.length} of {props.table.totalRows} rows and {columns.length} of{" "}
          {props.table.totalColumns} columns
        </div>
      ) : null}
    </div>
  );
}

function normalizeKeyValuePreview(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) {
    return null;
  }
  if (isRecord(value.items)) {
    return value.items;
  }
  return value;
}

function KeyValuePreview(props: { value: Record<string, unknown> }) {
  const entries = Object.entries(props.value).slice(0, 8);
  if (entries.length === 0) {
    return <p className="text-xs text-muted-foreground/55">No preview</p>;
  }

  return (
    <dl className="grid grid-cols-1 overflow-hidden rounded-md border border-border/60 bg-background/70 text-xs shadow-xs sm:grid-cols-[minmax(0,0.7fr)_minmax(0,1fr)]">
      {entries.map(([key, value]) => (
        <div key={key} className="contents">
          <dt className="border-b border-border/45 bg-muted/35 px-2.5 py-2 font-medium text-foreground/75 sm:border-r">
            <span className="line-clamp-2 break-words">{formatResearchCardLabel(key)}</span>
          </dt>
          <dd className="border-b border-border/45 px-2.5 py-2 font-mono text-[11px] text-muted-foreground/90">
            <span className="line-clamp-3 break-words">{formatPreviewCell(value)}</span>
          </dd>
        </div>
      ))}
    </dl>
  );
}

function ImagePreview(props: { card: ResearchCard; preview: Record<string, unknown> }) {
  const data = getStringValue(props.preview, ["data", "base64"]);
  const url = getStringValue(props.preview, ["url", "src", "uri"]);
  const format = getStringValue(props.preview, ["format", "mimeType"]) ?? "png";
  const mimeType = format.includes("/")
    ? format
    : format === "svg"
      ? "image/svg+xml"
      : `image/${format}`;
  const src = data ? `data:${mimeType};base64,${data}` : url;

  if (!src) {
    return <p className="text-xs text-muted-foreground/55">No image preview</p>;
  }

  return (
    <div className="overflow-hidden rounded-md border border-border/60 bg-background/75 shadow-xs">
      <img src={src} alt={props.card.title} className="max-h-80 w-full object-contain" />
    </div>
  );
}

function ChartPreview(props: { preview: Record<string, unknown> }) {
  const spec = isRecord(props.preview.spec) ? props.preview.spec : props.preview;
  const traces = Array.isArray(spec.data) ? spec.data.length : null;
  const layout = isRecord(spec.layout) ? spec.layout : null;
  const title =
    typeof layout?.title === "string"
      ? layout.title
      : isRecord(layout?.title) && typeof layout.title.text === "string"
        ? layout.title.text
        : "Chart specification";

  return (
    <div className="rounded-md border border-border/60 bg-background/70 px-3 py-2.5 shadow-xs">
      <div className="flex items-center gap-2 text-xs font-medium text-foreground/85">
        <BarChart3Icon className="size-4 text-indigo-600/80 dark:text-indigo-200/80" />
        <span className="min-w-0 truncate">{title}</span>
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground/70">
        {traces === null ? "Chart preview payload" : `${traces} trace${traces === 1 ? "" : "s"}`}
      </p>
    </div>
  );
}

function DecisionPreview(props: { preview: Record<string, unknown> }) {
  const fields = Array.isArray(props.preview.fields) ? props.preview.fields : null;
  if (!fields) {
    return null;
  }

  return (
    <div className="space-y-2 rounded-md border border-rose-200/70 bg-rose-50/45 px-3 py-2.5 text-xs shadow-xs dark:border-rose-400/15 dark:bg-rose-500/10">
      {fields.slice(0, 4).map((field) => {
        if (!isRecord(field)) {
          return null;
        }
        const name = formatPreviewCell(field.name);
        const question = formatPreviewCell(field.question ?? field.header ?? field.type);
        return (
          <div key={`${name}:${question}`} className="space-y-1">
            <div className="font-medium text-rose-700/75 dark:text-rose-200/75">{name}</div>
            <div className="text-foreground/80">{question}</div>
          </div>
        );
      })}
    </div>
  );
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

  const tablePreview = normalizeTablePreview(props.card.preview);
  if (tablePreview) {
    return <StructuredTablePreview table={tablePreview} />;
  }

  if (isRecord(props.card.preview)) {
    const markdown = getStringValue(props.card.preview, ["markdown", "text"]);
    if (props.card.type === "markdown" && markdown) {
      return (
        <div className="research-card-markdown text-sm leading-6">
          <ChatMarkdown text={markdown.trim()} cwd={props.cwd} isStreaming={false} />
        </div>
      );
    }

    if (props.card.type === "keyValue") {
      const keyValuePreview = normalizeKeyValuePreview(props.card.preview);
      if (keyValuePreview) {
        return <KeyValuePreview value={keyValuePreview} />;
      }
    }

    if (props.card.type === "image") {
      return <ImagePreview card={props.card} preview={props.card.preview} />;
    }

    if (props.card.type === "chart") {
      return <ChartPreview preview={props.card.preview} />;
    }

    if (props.card.type === "decision") {
      return <DecisionPreview preview={props.card.preview} />;
    }
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

interface PreviewState {
  readonly artifactId: string;
  readonly status: "loading" | "ready" | "error";
  readonly text: string | null;
  readonly message: string | null;
  readonly detail?: string;
}

function joinWorkspacePath(root: string, relativePath: string): string {
  return `${root.replace(/[\\/]+$/, "")}/${relativePath.replace(/^[\\/]+/, "")}`;
}

function shortContentHash(hash: string | undefined): string {
  if (!hash) {
    return "unknown";
  }
  const value = hash.startsWith("sha256:") ? hash.slice("sha256:".length) : hash;
  return value.slice(0, 12);
}

function ArtifactReferences(props: {
  artifacts: ResearchCard["artifacts"];
  consistencyStatus: ResearchCardDependencyStatus;
  cwd: string | undefined;
  environmentId: Session["environmentId"];
}) {
  const [preview, setPreview] = useState<PreviewState | null>(null);
  if (props.artifacts.length === 0) {
    return null;
  }

  const previewArtifact = async (artifact: ResearchCard["artifacts"][number]) => {
    if (!props.cwd) return;
    setPreview({ artifactId: artifact.id, status: "loading", text: null, message: null });
    try {
      const result = await loadResearchArtifactPreview({
        study: ensureEnvironmentApi(props.environmentId).study,
        studyRoot: props.cwd,
        artifact,
      });
      setPreview({
        artifactId: artifact.id,
        status: "ready",
        text: result.text,
        message: result.message,
        ...(result.detail ? { detail: result.detail } : {}),
      });
    } catch (error) {
      setPreview({
        artifactId: artifact.id,
        status: "error",
        text: null,
        message: error instanceof Error ? error.message : "Preview failed.",
      });
    }
  };

  const openArtifact = async (artifact: ResearchCard["artifacts"][number]) => {
    if (!props.cwd) return;
    let relativePath = artifact.path;
    try {
      const result = await ensureEnvironmentApi(props.environmentId).study.getArtifact({
        studyRoot: props.cwd,
        artifactId: artifact.id as ResearchArtifactId,
      });
      relativePath = result.relativePath;
    } catch {
      if (!relativePath) return;
    }
    const api = ensureLocalApi();
    const { availableEditors } = await api.server.getConfig();
    const editor = resolveAndPersistPreferredEditor(availableEditors);
    if (!editor) return;
    await api.shell.openInEditor(
      joinWorkspacePath(props.cwd, relativePath),
      editor,
      artifact.lineStart !== undefined ? { line: Math.max(1, artifact.lineStart) } : undefined,
    );
  };

  return (
    <div className="grid gap-1.5">
      {props.artifacts.map((artifact) => {
        const label = artifact.label ?? artifact.path ?? artifact.uri ?? artifact.id;
        const detail = artifact.path ?? artifact.uri ?? artifact.mimeType ?? artifact.id;
        const canOpen = Boolean(props.cwd && (artifact.path || artifact.id));
        return (
          <div
            key={artifact.id}
            className="rounded-md border border-border/50 bg-background/55 px-2.5 py-2 shadow-xs"
          >
            <div className="flex min-w-0 items-center gap-2">
              <Badge variant="outline" size="sm" className="font-mono">
                {artifact.kind}
              </Badge>
              <span className="min-w-0 truncate text-xs font-medium text-foreground/85">
                {label}
              </span>
              <Badge variant="outline" size="sm" className="ml-auto font-mono">
                {artifact.contentHash ? props.consistencyStatus : "unknown"}
              </Badge>
              <button
                type="button"
                disabled={!canOpen}
                aria-label={`Preview ${label}`}
                title="Preview"
                className="inline-flex size-6 shrink-0 items-center justify-center rounded-md border border-border/60 bg-background/65 text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                onClick={() => void previewArtifact(artifact)}
              >
                <EyeIcon className="size-3.5" />
              </button>
              <button
                type="button"
                disabled={!canOpen}
                aria-label={`Open ${label} in editor`}
                title="Open in editor"
                className="inline-flex size-6 shrink-0 items-center justify-center rounded-md border border-border/60 bg-background/65 text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                onClick={() => void openArtifact(artifact)}
              >
                <ExternalLinkIcon className="size-3.5" />
              </button>
            </div>
            {detail !== label ? (
              <p className="mt-1 flex min-w-0 items-center gap-2 font-mono text-[11px] text-muted-foreground/60">
                <span className="min-w-0 truncate">{detail}</span>
                <span className="shrink-0">#{shortContentHash(artifact.contentHash)}</span>
              </p>
            ) : null}
            {artifact.role ? (
              <p className="mt-1 text-[11px] text-muted-foreground/65">{artifact.role}</p>
            ) : null}
            {preview?.artifactId === artifact.id ? (
              <div className="mt-2 overflow-hidden rounded-md border border-border/55 bg-card/70">
                {preview.status === "loading" ? (
                  <div className="px-3 py-2 text-xs text-muted-foreground/70">
                    Loading preview...
                  </div>
                ) : preview.text !== null ? (
                  <>
                    {preview.detail ? (
                      <div className="border-b border-border/50 px-3 py-1.5 font-mono text-[10px] text-muted-foreground/65">
                        {preview.detail}
                      </div>
                    ) : null}
                    <pre className="max-h-80 overflow-auto p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-foreground/85">
                      {preview.text}
                    </pre>
                  </>
                ) : (
                  <>
                    {preview.detail ? (
                      <div className="border-b border-border/50 px-3 py-1.5 font-mono text-[10px] text-muted-foreground/65">
                        {preview.detail}
                      </div>
                    ) : null}
                    <div className="px-3 py-2 text-xs text-muted-foreground/70">
                      {preview.message ?? "No preview available."}
                    </div>
                  </>
                )}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function DependencyReferences(props: {
  dependencies: ReadonlyArray<ResearchCardDependency>;
  consistencyStatus: ResearchCardDependencyStatus;
  cwd: string | undefined;
  environmentId: Session["environmentId"];
}) {
  const artifacts = props.dependencies.map((dependency) => ({
    id: dependency.id,
    kind: dependency.kind === "script" ? ("code" as const) : ("other" as const),
    path: dependency.relativePath,
    lineStart: dependency.lineRange?.start,
    lineEnd: dependency.lineRange?.end,
    contentHash: dependency.contentHash,
    role: dependency.role,
    label: dependency.relativePath,
  }));

  if (artifacts.length === 0) {
    return null;
  }

  return (
    <div className="space-y-1.5">
      <div className="text-[10px] font-semibold tracking-wide text-muted-foreground/65 uppercase">
        Dependencies
      </div>
      <ArtifactReferences
        artifacts={artifacts}
        consistencyStatus={props.consistencyStatus}
        cwd={props.cwd}
        environmentId={props.environmentId}
      />
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
    <div className="space-y-2 rounded-md border border-rose-200/70 bg-rose-50/55 px-3 py-2.5 shadow-xs dark:border-rose-400/15 dark:bg-rose-500/10">
      <div>
        <div className="text-[10px] font-semibold tracking-wide text-rose-700/70 uppercase dark:text-rose-200/70">
          Review prompt
        </div>
        <p className="mt-1 text-xs leading-5 text-foreground/80">{props.review.prompt}</p>
      </div>
      {responseText ? (
        <div>
          <div className="text-[10px] font-semibold tracking-wide text-rose-700/70 uppercase dark:text-rose-200/70">
            Review response
          </div>
          <p className="mt-1 text-xs leading-5 text-foreground/80">{responseText}</p>
        </div>
      ) : null}
    </div>
  );
}

function ProvenanceSummary(props: { provenance: ResearchCard["provenance"] }) {
  const provenance = props.provenance[0];
  if (!provenance) {
    return null;
  }

  const values = [
    provenance.dataset ? ["Dataset", provenance.dataset] : null,
    provenance.source ? ["Source", provenance.source] : null,
    provenance.backend ? ["Backend", provenance.backend] : null,
  ].filter((value): value is [string, string] => value !== null);

  if (values.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5 border-t border-border/45 px-3 py-2 text-[11px] text-muted-foreground/70">
      <DatabaseIcon className="size-3.5 text-muted-foreground/55" />
      {values.slice(0, 3).map(([label, value]) => (
        <span
          key={label}
          className="inline-flex max-w-full items-center gap-1 rounded-sm bg-muted/45 px-1.5 py-0.5"
        >
          <span className="font-medium text-foreground/60">{label}</span>
          <span className="min-w-0 truncate font-mono">{value}</span>
        </span>
      ))}
    </div>
  );
}

function ResearchCardItem(props: {
  item: ScopedResearchCard;
  manifest: ResearchCardManifest | undefined;
  scope: ResearchCardScope;
  timestampFormat: TimestampFormat;
}) {
  const { card } = props.item;
  const artifactCount = card.artifacts.length;
  const consistencyStatus = props.manifest?.consistency.status ?? "unknown";
  const presentation = CARD_TYPE_PRESENTATION[card.type];
  const isActive = isActiveResearchCard(card);
  const statusLabel = formatResearchCardLabel(card.status);
  const Icon = presentation.Icon;

  return (
    <article
      className={cn(
        "group/card relative overflow-hidden rounded-lg border bg-card text-card-foreground shadow-[0_1px_0_color-mix(in_srgb,var(--foreground)_6%,transparent),0_12px_28px_color-mix(in_srgb,var(--foreground)_5%,transparent)] transition-[border-color,box-shadow,transform] duration-200",
        "hover:-translate-y-0.5 hover:shadow-[0_1px_0_color-mix(in_srgb,var(--foreground)_8%,transparent),0_18px_36px_color-mix(in_srgb,var(--foreground)_8%,transparent)]",
        presentation.shellClassName,
        !isActive && "opacity-[0.82]",
      )}
    >
      <div
        className={cn(
          "border-b border-border/35 px-3 py-2.5",
          presentation.headerClassName,
          !isActive && "bg-muted/35 dark:bg-muted/20",
        )}
      >
        <div className="flex min-w-0 items-center gap-3">
          <div
            className={cn(
              "flex size-8 shrink-0 items-center justify-center rounded-md border shadow-xs",
              presentation.iconClassName,
            )}
          >
            <Icon className="size-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center justify-between gap-3">
              <h3
                className="truncate text-sm leading-5 font-semibold text-foreground"
                title={card.title}
              >
                {card.title}
              </h3>
              <div className="shrink-0 text-right text-[11px] text-muted-foreground/70">
                <div>{formatShortTimestamp(card.updatedAt, props.timestampFormat)}</div>
                <div className="mt-0.5 font-mono">
                  {artifactCount} {artifactCount === 1 ? "artifact" : "artifacts"}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 border-b border-border/35 bg-card/65 px-3 py-2">
        <Badge variant="outline" size="sm" className="bg-background/55 font-mono">
          {presentation.label}
        </Badge>
        <Badge variant={getStatusBadgeVariant(card.status)} size="sm">
          {statusLabel}
        </Badge>
        <Badge variant="outline" size="sm" className="font-mono">
          {consistencyStatus}
        </Badge>
        {props.scope === "study" ? (
          <span className="min-w-0 truncate rounded-sm bg-background/45 px-1.5 py-0.5 text-[11px] text-muted-foreground/75">
            {props.item.sessionTitle}
          </span>
        ) : null}
      </div>
      <div className="space-y-3 px-3 py-3">
        <PreviewContent card={card} cwd={props.item.cwd} />
        <ArtifactReferences
          artifacts={props.manifest?.artifacts ?? card.artifacts}
          consistencyStatus={consistencyStatus}
          cwd={props.item.cwd}
          environmentId={props.item.environmentId}
        />
        <DependencyReferences
          dependencies={props.manifest?.dependencies ?? []}
          consistencyStatus={consistencyStatus}
          cwd={props.item.cwd}
          environmentId={props.item.environmentId}
        />
        <ReviewMetadata review={card.review} />
      </div>
      <ProvenanceSummary provenance={card.provenance} />
    </article>
  );
}

export default function ResearchCardsPanel({ mode = "inline" }: ResearchCardsPanelProps) {
  const settings = useSettings();
  const [scope, setScope] = useState<ResearchCardScope>("session");
  const [studyCardManifests, setStudyCardManifests] = useState<
    Record<string, ResearchCardManifest>
  >({});
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
  const sessions = useStore(useShallow(selectSessionsAcrossEnvironments));
  useEffect(() => {
    let cancelled = false;
    if (!activeSession || !activeProject?.cwd) {
      setStudyCardManifests({});
      return;
    }

    void ensureEnvironmentApi(activeSession.environmentId)
      .study.getStatus({ studyRoot: activeProject.cwd })
      .then((status) => {
        if (cancelled) return;
        setStudyCardManifests(
          Object.fromEntries(status.cards.map((manifest) => [manifest.id, manifest])),
        );
      })
      .catch(() => {
        if (!cancelled) {
          setStudyCardManifests({});
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeProject?.cwd, activeSession]);
  const orderedCards = useMemo(
    () =>
      (scope === "session"
        ? sessionScopedCards(activeSession, activeProject?.cwd)
        : studyScopedCards({
            activeSession,
            sessions,
            projectCwd: activeProject?.cwd,
          })
      ).toSorted(compareResearchCards),
    [activeProject?.cwd, activeSession, scope, sessions],
  );
  const header = (
    <div className="flex min-w-0 flex-1 items-center justify-between gap-3 [-webkit-app-region:no-drag]">
      <div className="flex min-w-0 items-center gap-2">
        <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-md border border-border/70 bg-background/70 text-muted-foreground shadow-xs">
          <LayersIcon className="size-3.5" />
        </span>
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-foreground">Research cards</div>
          <div className="text-[11px] text-muted-foreground/65">
            {orderedCards.length} {orderedCards.length === 1 ? "card" : "cards"}
          </div>
        </div>
      </div>
      <div className="min-w-0">
        <ToggleGroup
          className="shrink-0"
          variant="outline"
          size="xs"
          value={[scope]}
          onValueChange={(value) => {
            const nextScope = value[0];
            if (nextScope === "session" || nextScope === "study") {
              setScope(nextScope);
            }
          }}
        >
          <Toggle value="session" aria-label="Show cards for this session">
            Session
          </Toggle>
          <Toggle value="study" aria-label="Show cards for this study">
            Study
          </Toggle>
        </ToggleGroup>
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
        <div className="min-h-0 flex-1 overflow-auto bg-[color-mix(in_srgb,var(--background)_96%,var(--muted))] p-3">
          <div className="space-y-3">
            {orderedCards.map((item) => (
              <ResearchCardItem
                key={`${item.sessionId}:${item.card.id}`}
                item={item}
                manifest={studyCardManifests[item.card.id]}
                scope={scope}
                timestampFormat={settings.timestampFormat}
              />
            ))}
          </div>
        </div>
      )}
    </DiffPanelShell>
  );
}
