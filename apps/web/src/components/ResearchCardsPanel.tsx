import { useParams } from "@tanstack/react-router";
import { scopeProjectRef } from "@t3tools/client-runtime";
import {
  isActiveResearchCard,
  normalizeResearchCardMarkdownPreviewText,
} from "@t3tools/shared/researchCards";
import type {
  EnvironmentId,
  OrchestrationCommand,
  ResearchCardId,
  SessionId,
} from "@t3tools/contracts";
import type { TimestampFormat } from "@t3tools/contracts/settings";
import type {
  ResearchCardDependency,
  ResearchCardDependencyStatus,
  ResearchCardManifest,
  ResearchArtifactId,
} from "@t3tools/contracts/researchStudy";
import {
  BarChart3Icon,
  CheckIcon,
  DatabaseIcon,
  Edit3Icon,
  ExternalLinkIcon,
  EyeIcon,
  LayersIcon,
  RefreshCwIcon,
  XIcon,
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
import type { ResearchCardDetail, Session } from "../types";
import { useSettings } from "../hooks/useSettings";
import { cn, newCommandId } from "../lib/utils";
import ChatMarkdown from "./ChatMarkdown";
import { DiffPanelShell, type DiffPanelMode } from "./DiffPanelShell";
import { loadResearchArtifactPreview } from "./ResearchCardsPanel.logic";
import {
  CARD_TYPE_PRESENTATION,
  compareResearchCards,
  formatResearchCardLabel,
  getStatusBadgeVariant,
  sessionScopedCards,
  studyScopedCards,
  type NormalizedTablePreview,
  type ScopedResearchCard,
} from "./researchCards/researchCardLists";
import { Badge } from "./ui/badge";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

interface ResearchCardsPanelProps {
  mode?: DiffPanelMode;
}

type ResearchCardScope = "session" | "study";
type ReviewUiAction = "accept" | "request_changes" | "reject";
type ResearchCardReviewCommand = Extract<
  OrchestrationCommand,
  { type: "session.research-card.review" }
>;

const RESEARCH_CARD_SCOPE_OPTIONS = [
  {
    value: "session",
    label: "Session",
    ariaLabel: "Show cards for this session",
  },
  {
    value: "study",
    label: "Study",
    ariaLabel: "Show cards for this study",
  },
] satisfies ReadonlyArray<{
  value: ResearchCardScope;
  label: string;
  ariaLabel: string;
}>;

const REVIEW_ACTIONS = [
  { uiAction: "accept", label: "Accept", requiresNote: false, Icon: CheckIcon },
  {
    uiAction: "request_changes",
    label: "Request changes",
    requiresNote: true,
    Icon: RefreshCwIcon,
  },
  { uiAction: "reject", label: "Reject", requiresNote: true, Icon: XIcon },
] satisfies ReadonlyArray<{
  uiAction: ReviewUiAction;
  label: string;
  requiresNote: boolean;
  Icon: LucideIcon;
}>;

function reviewUiActionToResponseAction(action: ReviewUiAction): string {
  return action;
}

function buildResearchCardReviewCommand(input: {
  readonly sessionId: SessionId;
  readonly cardId: ResearchCardId;
  readonly action: ReviewUiAction;
  readonly note: string;
  readonly timestamp: string;
}): ResearchCardReviewCommand {
  const trimmedNote = input.note.trim();
  return {
    type: "session.research-card.review",
    commandId: newCommandId(),
    sessionId: input.sessionId,
    cardId: input.cardId,
    response: {
      action: reviewUiActionToResponseAction(input.action),
      ...(trimmedNote.length > 0 ? { message: trimmedNote } : {}),
      timestamp: input.timestamp,
    },
    createdAt: input.timestamp,
  };
}

function shouldShowReviewPrompt(prompt: string): boolean {
  return prompt.trim().toLowerCase() !== "human review";
}

function mergeResearchCardReview(
  detailReview: ResearchCardDetail["review"] | undefined,
  summaryReview: ResearchCardDetail["review"] | undefined,
): ResearchCardDetail["review"] | undefined {
  if (!detailReview && !summaryReview) {
    return undefined;
  }

  return {
    prompt: detailReview?.prompt ?? summaryReview?.prompt ?? "Human review",
    actions: detailReview?.actions ?? summaryReview?.actions ?? [],
    ...((summaryReview?.response ?? detailReview?.response)
      ? { response: summaryReview?.response ?? detailReview?.response }
      : {}),
  };
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

function ImagePreview(props: { card: ResearchCardDetail; preview: Record<string, unknown> }) {
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

interface ChartSeriesPreview {
  readonly name: string;
  readonly x: string[];
  readonly y: number[];
  readonly type: "bar" | "line";
}

const CHART_SERIES_COLORS = ["#0f766e", "#4f46e5", "#dc2626", "#d97706", "#7c3aed"];

function numberArray(value: unknown): number[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const numbers = value.map((entry) => (typeof entry === "number" ? entry : Number(entry)));
  return numbers.every(Number.isFinite) ? numbers : null;
}

function stringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  return value.map(formatPreviewCell);
}

function normalizeChartSeries(spec: Record<string, unknown>): ChartSeriesPreview[] {
  const data = Array.isArray(spec.data) ? spec.data : null;
  if (!data) {
    const x = stringArray(spec.x);
    const series = Array.isArray(spec.series) ? spec.series : null;
    if (!x || !series) return [];
    return series.flatMap((entry) => {
      if (!isRecord(entry)) return [];
      const y = numberArray(entry.values ?? entry.y);
      if (!y) return [];
      return [
        {
          name: getStringValue(entry, ["name", "label"]) ?? "Series",
          x,
          y,
          type: "line" as const,
        },
      ];
    });
  }

  return data.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const x = stringArray(entry.x);
    const y = numberArray(entry.y);
    if (!x || !y) return [];
    return [
      {
        name: getStringValue(entry, ["name", "label"]) ?? "Series",
        x,
        y,
        type: entry.type === "bar" ? "bar" : "line",
      },
    ];
  });
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
  const series = normalizeChartSeries(spec);
  const categories = Array.from(new Set(series.flatMap((entry) => entry.x))).slice(0, 10);
  const plottedSeries = series
    .map((entry) => {
      const nextEntry: ChartSeriesPreview = {
        name: entry.name,
        type: entry.type,
        x: entry.x.slice(0, categories.length),
        y: entry.y.slice(0, categories.length),
      };
      return nextEntry;
    })
    .filter((entry) => entry.y.length > 0)
    .slice(0, 5);
  const values = plottedSeries.flatMap((entry) => entry.y);
  const maxValue = Math.max(...values, 1);
  const minValue = Math.min(...values, 0);
  const valueRange = Math.max(maxValue - minValue, 1);
  const hasBars = plottedSeries.some((entry) => entry.type === "bar");
  const width = 640;
  const height = 280;
  const padLeft = 56;
  const padRight = 28;
  const padTop = 32;
  const padBottom = 58;
  const plotWidth = width - padLeft - padRight;
  const plotHeight = height - padTop - padBottom;
  const xStep = categories.length > 1 ? plotWidth / (categories.length - 1) : plotWidth;
  const barGroupWidth =
    categories.length > 0 ? Math.min(46, plotWidth / categories.length / 1.45) : 0;
  const barSeries = plottedSeries.filter((entry) => entry.type === "bar");

  const xForIndex = (index: number) =>
    padLeft + (categories.length > 1 ? index * xStep : plotWidth / 2);
  const yForValue = (value: number) =>
    padTop + plotHeight - ((value - minValue) / valueRange) * plotHeight;

  if (plottedSeries.length === 0 || categories.length === 0) {
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

  return (
    <div className="overflow-hidden rounded-md border border-border/60 bg-background/75 shadow-xs">
      <div className="flex items-center gap-2 text-xs font-medium text-foreground/85">
        <BarChart3Icon className="ml-3 mt-3 size-4 text-indigo-600/80 dark:text-indigo-200/80" />
        <span className="min-w-0 truncate">{title}</span>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={title}
        className="h-64 w-full text-muted-foreground"
      >
        <rect x="0" y="0" width={width} height={height} fill="transparent" />
        {[0, 0.5, 1].map((tick) => {
          const value = minValue + valueRange * tick;
          const y = yForValue(value);
          return (
            <g key={tick}>
              <line
                x1={padLeft}
                y1={y}
                x2={width - padRight}
                y2={y}
                stroke="currentColor"
                strokeOpacity="0.16"
              />
              <text
                x={padLeft - 8}
                y={y + 4}
                textAnchor="end"
                className="fill-muted-foreground text-[10px]"
              >
                {value.toFixed(maxValue <= 1 ? 2 : 1)}
              </text>
            </g>
          );
        })}
        <line
          x1={padLeft}
          y1={padTop + plotHeight}
          x2={width - padRight}
          y2={padTop + plotHeight}
          stroke="currentColor"
          strokeOpacity="0.32"
        />
        <line
          x1={padLeft}
          y1={padTop}
          x2={padLeft}
          y2={padTop + plotHeight}
          stroke="currentColor"
          strokeOpacity="0.32"
        />
        {hasBars
          ? barSeries.map((entry, seriesIndex) =>
              entry.y.map((value, index) => {
                const color = CHART_SERIES_COLORS[seriesIndex % CHART_SERIES_COLORS.length];
                const x =
                  xForIndex(index) -
                  barGroupWidth / 2 +
                  (barGroupWidth / Math.max(barSeries.length, 1)) * seriesIndex;
                const barWidth = Math.max(barGroupWidth / Math.max(barSeries.length, 1) - 2, 4);
                const y = yForValue(value);
                return (
                  <rect
                    key={`${entry.name}:${categories[index] ?? "category"}:${value}`}
                    x={x}
                    y={y}
                    width={barWidth}
                    height={padTop + plotHeight - y}
                    rx="2"
                    fill={color}
                    opacity="0.86"
                  >
                    <title>{`${entry.name}: ${categories[index]} ${value}`}</title>
                  </rect>
                );
              }),
            )
          : null}
        {plottedSeries
          .filter((entry) => entry.type !== "bar")
          .map((entry, seriesIndex) => {
            const color = CHART_SERIES_COLORS[seriesIndex % CHART_SERIES_COLORS.length];
            const points = entry.y
              .map((value, index) => `${xForIndex(index)},${yForValue(value)}`)
              .join(" ");
            return (
              <g key={entry.name}>
                <polyline points={points} fill="none" stroke={color} strokeWidth="3" />
                {entry.y.map((value, index) => (
                  <circle
                    key={`${entry.name}:${categories[index] ?? "category"}:${value}`}
                    cx={xForIndex(index)}
                    cy={yForValue(value)}
                    r="4"
                    fill={color}
                  >
                    <title>{`${entry.name}: ${categories[index]} ${value}`}</title>
                  </circle>
                ))}
              </g>
            );
          })}
        {categories.map((label, index) => (
          <text
            key={label}
            x={xForIndex(index)}
            y={height - 30}
            textAnchor="middle"
            className="fill-muted-foreground text-[10px]"
          >
            {label}
          </text>
        ))}
        {plottedSeries.map((entry, index) => (
          <g key={entry.name} transform={`translate(${padLeft + index * 120}, ${height - 12})`}>
            <rect
              width="9"
              height="9"
              rx="2"
              fill={CHART_SERIES_COLORS[index % CHART_SERIES_COLORS.length]}
            />
            <text x="14" y="9" className="fill-muted-foreground text-[10px]">
              {entry.name}
            </text>
          </g>
        ))}
      </svg>
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

function PreviewContent(props: { card: ResearchCardDetail; cwd: string | undefined }) {
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
        <ChatMarkdown
          text={normalizeResearchCardMarkdownPreviewText(preview)}
          cwd={props.cwd}
          isStreaming={false}
        />
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
          <ChatMarkdown
            text={normalizeResearchCardMarkdownPreviewText(markdown.trim())}
            cwd={props.cwd}
            isStreaming={false}
          />
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

function renderConsistencyStatus(
  status: ResearchCardDependencyStatus,
  options?: { readonly artifactHasHash?: boolean },
) {
  if (status === "unknown" || options?.artifactHasHash === false) {
    return null;
  }
  return status;
}

function ArtifactReferences(props: {
  artifacts: ResearchCardDetail["artifacts"];
  consistencyStatus: ResearchCardDependencyStatus;
  cwd: string | undefined;
  environmentId: Session["environmentId"];
  sessionId: Session["id"];
}) {
  const [preview, setPreview] = useState<PreviewState | null>(null);
  if (props.artifacts.length === 0) {
    return null;
  }

  const previewArtifact = async (artifact: ResearchCardDetail["artifacts"][number]) => {
    setPreview({ artifactId: artifact.id, status: "loading", text: null, message: null });
    try {
      const result = await loadResearchArtifactPreview({
        study: ensureEnvironmentApi(props.environmentId).study,
        sessionId: props.sessionId,
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

  const openArtifact = async (artifact: ResearchCardDetail["artifacts"][number]) => {
    if (!props.cwd) return;
    let relativePath = artifact.path;
    try {
      const result = await ensureEnvironmentApi(props.environmentId).study.getArtifact({
        sessionId: props.sessionId,
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
        const canPreview = Boolean(artifact.id || artifact.path);
        const canOpen = Boolean(props.cwd && (artifact.path || artifact.id));
        const consistencyLabel = renderConsistencyStatus(props.consistencyStatus, {
          artifactHasHash: Boolean(artifact.contentHash),
        });
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
              <span className="ml-auto" />
              {consistencyLabel ? (
                <Badge variant="outline" size="sm" className="font-mono">
                  {consistencyLabel}
                </Badge>
              ) : null}
              <button
                type="button"
                disabled={!canPreview}
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
  sessionId: Session["id"];
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
        sessionId={props.sessionId}
      />
    </div>
  );
}

export function ResearchCardReviewSection(props: {
  review: ResearchCardDetail["review"] | undefined;
  environmentId: EnvironmentId;
  sessionId: SessionId;
  cardId: ResearchCardId;
}) {
  const [note, setNote] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const [submittingAction, setSubmittingAction] = useState<ReviewUiAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const responseText =
    props.review?.response?.summary ??
    props.review?.response?.message ??
    props.review?.response?.action ??
    null;
  const isSubmitting = submittingAction !== null;
  const isCompletedReview = props.review?.response !== undefined;
  const shouldShowControls = !isCompletedReview || isEditing;

  const submitReview = async (action: ReviewUiAction) => {
    const actionMeta = REVIEW_ACTIONS.find((candidate) => candidate.uiAction === action);
    const trimmedNote = note.trim();
    if (actionMeta?.requiresNote && trimmedNote.length === 0) {
      setError(`Add a note to ${action === "reject" ? "reject" : "request changes"}.`);
      return;
    }

    const timestamp = new Date().toISOString();
    setSubmittingAction(action);
    setError(null);
    try {
      await ensureEnvironmentApi(props.environmentId).orchestration.dispatchCommand(
        buildResearchCardReviewCommand({
          sessionId: props.sessionId,
          cardId: props.cardId,
          action,
          note: trimmedNote,
          timestamp,
        }),
      );
      setNote("");
      setIsEditing(false);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Review submit failed.");
    } finally {
      setSubmittingAction(null);
    }
  };

  return (
    <div className="space-y-2 rounded-md border border-border/50 bg-background/55 px-2.5 py-2 shadow-xs">
      {props.review ? (
        <div className="space-y-1">
          <div className="text-[10px] font-semibold tracking-wide text-muted-foreground/70 uppercase">
            Human review
          </div>
          {shouldShowReviewPrompt(props.review.prompt) ? (
            <p className="mt-1 text-xs leading-5 text-foreground/80">{props.review.prompt}</p>
          ) : null}
        </div>
      ) : null}
      {responseText ? (
        <div className="flex min-w-0 items-center gap-2 rounded-sm bg-muted/35 px-2 py-1 text-xs leading-5 text-muted-foreground/85">
          <p className="min-w-0 flex-1">
            <span className="font-medium text-foreground/70">Latest response:</span> {responseText}
          </p>
          {!shouldShowControls ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    aria-label="Edit review"
                    className="inline-flex size-7 shrink-0 items-center justify-center rounded-md border border-border/60 bg-background/75 text-muted-foreground shadow-xs transition-colors hover:border-foreground/25 hover:bg-background hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background focus-visible:outline-none"
                    onClick={() => {
                      setIsEditing(true);
                      setError(null);
                      setNote(
                        props.review?.response?.message ?? props.review?.response?.summary ?? "",
                      );
                    }}
                  />
                }
              >
                <Edit3Icon className="size-3.5" />
              </TooltipTrigger>
              <TooltipPopup side="top">Edit review</TooltipPopup>
            </Tooltip>
          ) : null}
        </div>
      ) : null}
      {shouldShowControls ? (
        <div className="space-y-1.5">
          <label className="grid min-w-0 gap-1">
            <span className="sr-only">Reviewer note</span>
            <textarea
              value={note}
              disabled={isSubmitting}
              rows={1}
              aria-label="Reviewer note"
              placeholder="Add note. Required for changes or rejection."
              className="min-h-9 resize-y rounded-md border border-border/65 bg-card/85 px-2.5 py-2 text-xs leading-5 text-foreground shadow-xs outline-none transition-colors placeholder:text-muted-foreground/55 focus:border-ring disabled:cursor-not-allowed disabled:opacity-60"
              onChange={(event) => {
                setNote(event.currentTarget.value);
                if (error) {
                  setError(null);
                }
              }}
            />
          </label>
          {error ? (
            <p role="alert" className="text-xs leading-5 text-destructive">
              {error}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-1.5">
            {REVIEW_ACTIONS.map((action) => (
              <Tooltip key={action.uiAction}>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      disabled={isSubmitting}
                      aria-label={action.label}
                      aria-busy={submittingAction === action.uiAction}
                      className={cn(
                        "inline-flex size-8 items-center justify-center rounded-md border bg-background/80 shadow-xs transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-55",
                        action.uiAction === "accept"
                          ? "border-emerald-200/85 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-400/20 dark:text-emerald-200 dark:hover:bg-emerald-500/10"
                          : action.uiAction === "request_changes"
                            ? "border-amber-200/90 text-amber-800 hover:bg-amber-50 dark:border-amber-400/20 dark:text-amber-200 dark:hover:bg-amber-500/10"
                            : "border-rose-200/85 text-rose-700 hover:bg-rose-50 dark:border-rose-400/20 dark:text-rose-200 dark:hover:bg-rose-500/10",
                      )}
                      onClick={() => void submitReview(action.uiAction)}
                    />
                  }
                >
                  <action.Icon className="size-4" />
                </TooltipTrigger>
                <TooltipPopup side="top">{action.label}</TooltipPopup>
              </Tooltip>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ProvenanceSummary(props: { provenance: ResearchCardDetail["provenance"] }) {
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

function ResearchCardScopeSwitch(props: {
  scope: ResearchCardScope;
  onScopeChange: (scope: ResearchCardScope) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Research card scope"
      className="relative isolate grid w-40 shrink-0 grid-cols-2 rounded-[5px] border border-border/65 bg-muted/35 p-0.5 shadow-xs"
    >
      <span
        aria-hidden="true"
        className={cn(
          "absolute top-0.5 bottom-0.5 left-0.5 z-0 w-[calc(50%-0.125rem)] rounded-[5px] bg-background shadow-sm ring-1 ring-border/65 transition-transform duration-200 ease-out dark:bg-input/80",
          props.scope === "study" && "translate-x-full",
        )}
      />
      {RESEARCH_CARD_SCOPE_OPTIONS.map((option) => {
        const active = props.scope === option.value;
        return (
          <button
            key={option.value}
            type="button"
            aria-label={option.ariaLabel}
            aria-pressed={active}
            className={cn(
              "relative z-10 inline-flex h-5 items-center justify-center rounded-[5px] px-2 text-[11px] font-medium transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background focus-visible:outline-none",
              active ? "text-foreground" : "text-muted-foreground/75 hover:text-foreground/85",
            )}
            onClick={() => props.onScopeChange(option.value)}
          >
            {option.label}
          </button>
        );
      })}
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
  const [detail, setDetail] = useState<ResearchCardDetail | null>(null);
  const [detailFailed, setDetailFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    setDetailFailed(false);
    void ensureEnvironmentApi(props.item.environmentId)
      .orchestration.getResearchCardDetail({
        sessionId: props.item.sessionId,
        cardId: card.id,
      })
      .then((nextDetail) => {
        if (!cancelled) {
          setDetail(nextDetail);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setDetailFailed(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [card.id, props.item.environmentId, props.item.sessionId]);
  const artifactCount = detail?.artifacts.length ?? card.artifactCount;
  const consistencyStatus = props.manifest?.consistency.status ?? "unknown";
  const consistencyLabel = renderConsistencyStatus(consistencyStatus);
  const presentation = CARD_TYPE_PRESENTATION[card.type];
  const isActive = isActiveResearchCard(card);
  const statusLabel = formatResearchCardLabel(card.status);
  const Icon = presentation.Icon;
  const review = mergeResearchCardReview(detail?.review, card.review);
  const isReviewRequired = isActive && review?.response === undefined;

  return (
    <article
      className={cn(
        "group/card relative overflow-hidden rounded-lg border bg-card text-card-foreground shadow-[0_1px_0_color-mix(in_srgb,var(--foreground)_6%,transparent),0_12px_28px_color-mix(in_srgb,var(--foreground)_5%,transparent)] transition-[border-color,box-shadow,transform] duration-200",
        "hover:-translate-y-0.5 hover:shadow-[0_1px_0_color-mix(in_srgb,var(--foreground)_8%,transparent),0_18px_36px_color-mix(in_srgb,var(--foreground)_8%,transparent)]",
        presentation.shellClassName,
        isReviewRequired && presentation.reviewRequiredClassName,
        isReviewRequired &&
          "shadow-[0_1px_0_color-mix(in_srgb,var(--foreground)_16%,transparent),0_26px_64px_color-mix(in_srgb,var(--foreground)_20%,transparent)]",
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
        {consistencyLabel ? (
          <Badge variant="outline" size="sm" className="font-mono">
            {consistencyLabel}
          </Badge>
        ) : null}
        {props.scope === "study" ? (
          <span className="min-w-0 truncate rounded-sm bg-background/45 px-1.5 py-0.5 text-[11px] text-muted-foreground/75">
            {props.item.sessionTitle}
          </span>
        ) : null}
      </div>
      <div className="space-y-3 px-3 py-3">
        {detail ? (
          <>
            <PreviewContent card={detail} cwd={props.item.cwd} />
            <ArtifactReferences
              artifacts={props.manifest?.artifacts ?? detail.artifacts}
              consistencyStatus={consistencyStatus}
              cwd={props.item.cwd}
              environmentId={props.item.environmentId}
              sessionId={props.item.sessionId}
            />
          </>
        ) : (
          <p className="text-xs text-muted-foreground/55">
            {detailFailed
              ? "Card detail unavailable"
              : card.hasPreview || card.artifactCount > 0
                ? "Loading card detail..."
                : "No preview"}
          </p>
        )}
        <DependencyReferences
          dependencies={props.manifest?.dependencies ?? []}
          consistencyStatus={consistencyStatus}
          cwd={props.item.cwd}
          environmentId={props.item.environmentId}
          sessionId={props.item.sessionId}
        />
        <ResearchCardReviewSection
          review={review}
          environmentId={props.item.environmentId}
          sessionId={props.item.sessionId}
          cardId={card.id}
        />
      </div>
      <ProvenanceSummary provenance={detail?.provenance ?? []} />
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
    if (!activeSession) {
      setStudyCardManifests({});
      return;
    }

    void ensureEnvironmentApi(activeSession.environmentId)
      .study.getStatus({ projectId: activeSession.projectId })
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
  }, [activeSession]);
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
      <div className="shrink-0">
        <ResearchCardScopeSwitch scope={scope} onScopeChange={setScope} />
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
