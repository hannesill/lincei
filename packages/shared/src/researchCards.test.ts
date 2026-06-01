import { describe, expect, it } from "vitest";

import {
  attachResearchCardReviewResponse,
  isActiveResearchCard,
  normalizeResearchCardMarkdownPreviewText,
} from "./researchCards.ts";

describe("research card helpers", () => {
  it("treats terminal statuses as inactive", () => {
    expect(isActiveResearchCard({ status: "proposed" })).toBe(true);
    expect(isActiveResearchCard({ status: "review-requested" })).toBe(true);
    expect(isActiveResearchCard({ status: "withdrawn" })).toBe(false);
    expect(isActiveResearchCard({ status: "superseded" })).toBe(false);
    expect(isActiveResearchCard({ status: "dismissed" })).toBe(false);
  });

  it("keeps review responses for cards without a review request envelope", () => {
    expect(
      attachResearchCardReviewResponse(undefined, {
        action: "accept",
        timestamp: "2026-01-02T00:00:00.000Z",
      }),
    ).toEqual({
      prompt: "Human review",
      actions: [],
      response: {
        action: "accept",
        timestamp: "2026-01-02T00:00:00.000Z",
      },
    });
  });

  it("normalizes escaped markdown line breaks", () => {
    expect(normalizeResearchCardMarkdownPreviewText("# Heading\\n\\n| a | b |\\n| - | - |")).toBe(
      "# Heading\n\n| a | b |\n| - | - |",
    );
  });
});
