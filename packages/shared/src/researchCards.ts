import type {
  OrchestrationResearchCard,
  ResearchCardLifecycleStatus,
  ResearchCardReview,
  ResearchCardReviewResponse,
} from "@t3tools/contracts";

export const TERMINAL_RESEARCH_CARD_STATUSES = new Set<ResearchCardLifecycleStatus>([
  "dismissed",
  "rejected",
  "superseded",
  "withdrawn",
]);

export function isActiveResearchCard(card: Pick<OrchestrationResearchCard, "status">): boolean {
  return !TERMINAL_RESEARCH_CARD_STATUSES.has(card.status);
}

export function activeResearchCards(
  cards: ReadonlyArray<OrchestrationResearchCard>,
): ReadonlyArray<OrchestrationResearchCard> {
  return cards.filter(isActiveResearchCard);
}

export function normalizeResearchCardMarkdownPreviewText(text: string): string {
  return text
    .replace(/\\r\\n/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r");
}

export function attachResearchCardReviewResponse(
  review: ResearchCardReview | undefined,
  response: ResearchCardReviewResponse,
): ResearchCardReview {
  return {
    prompt: review?.prompt ?? "Human review",
    actions: review?.actions ?? [],
    response,
  };
}
