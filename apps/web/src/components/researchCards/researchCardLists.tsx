import { isActiveResearchCard } from "@t3tools/shared/researchCards";
import {
  BarChart3Icon,
  CheckSquareIcon,
  FileTextIcon,
  ImageIcon,
  KeyRoundIcon,
  Table2Icon,
  type LucideIcon,
} from "lucide-react";

import type { ResearchCard, Session } from "../../types";

export interface ScopedResearchCard {
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

export const CARD_TYPE_PRESENTATION = {
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

export interface NormalizedTablePreview {
  columns: string[];
  rows: Array<Record<string, unknown>>;
  totalRows: number;
  totalColumns: number;
}

export function formatResearchCardLabel(value: string): string {
  return value
    .split("-")
    .map((part) => (part.length > 0 ? `${part[0]?.toUpperCase()}${part.slice(1)}` : part))
    .join(" ");
}

export function getStatusBadgeVariant(status: ResearchCard["status"]) {
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

export function compareResearchCards(left: ScopedResearchCard, right: ScopedResearchCard): number {
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

export function cardCwd(session: Session, projectCwd: string | undefined): string | undefined {
  return session.worktreePath ?? projectCwd;
}

export function sessionScopedCards(
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

export function studyScopedCards(input: {
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
