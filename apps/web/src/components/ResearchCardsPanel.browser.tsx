import "../index.css";

import {
  EnvironmentId,
  ResearchCardId,
  SessionId,
  type EnvironmentApi,
  type OrchestrationCommand,
} from "@t3tools/contracts";
import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import {
  __resetEnvironmentApiOverridesForTests,
  __setEnvironmentApiOverrideForTests,
} from "../environmentApi";
import { ResearchCardReviewSection } from "./ResearchCardsPanel";

const ENVIRONMENT_ID = EnvironmentId.make("environment-review-test");
const SESSION_ID = SessionId.make("session-review-test");
const CARD_ID = ResearchCardId.make("card-review-test");

function makeEnvironmentApi(
  dispatchCommand: EnvironmentApi["orchestration"]["dispatchCommand"],
): EnvironmentApi {
  return {
    orchestration: {
      dispatchCommand,
    },
  } as unknown as EnvironmentApi;
}

async function renderReviewSection(input?: {
  readonly dispatchCommand?: EnvironmentApi["orchestration"]["dispatchCommand"];
  readonly completed?: boolean;
  readonly prompt?: string;
}) {
  const dispatchCommand = input?.dispatchCommand ?? vi.fn(async () => ({ sequence: 1 }));
  __setEnvironmentApiOverrideForTests(ENVIRONMENT_ID, makeEnvironmentApi(dispatchCommand));
  return {
    dispatchCommand,
    screen: await render(
      <ResearchCardReviewSection
        environmentId={ENVIRONMENT_ID}
        sessionId={SESSION_ID}
        cardId={CARD_ID}
        review={{
          prompt: input?.prompt ?? "Check the cohort denominator before manuscript use.",
          actions: [],
          ...((input?.completed ?? false)
            ? {
                response: {
                  action: "request_changes",
                  message: "Use the indexed admission.",
                  timestamp: "2026-05-31T12:00:00.000Z",
                },
              }
            : {}),
        }}
      />,
    ),
  };
}

function latestReviewCommand(dispatchCommand: EnvironmentApi["orchestration"]["dispatchCommand"]) {
  const calls = vi.mocked(dispatchCommand).mock.calls;
  return calls.at(-1)?.[0] as OrchestrationCommand | undefined;
}

describe("ResearchCardReviewSection", () => {
  afterEach(() => {
    __resetEnvironmentApiOverridesForTests();
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("renders the review prompt and latest response", async () => {
    const { screen } = await renderReviewSection({ completed: true });

    try {
      await expect
        .element(page.getByText("Check the cohort denominator before manuscript use."))
        .toBeVisible();
      await expect.element(page.getByText("Use the indexed admission.")).toBeVisible();
    } finally {
      await screen.unmount();
    }
  });

  it("uses Human review as the section title and hides the fallback prompt body", async () => {
    const { screen } = await renderReviewSection({
      completed: true,
      prompt: "Human review",
    });

    try {
      await expect.element(page.getByText("Human review")).toBeVisible();
      expect((document.body.textContent ?? "").match(/Human review/g)?.length).toBe(1);
      await expect.element(page.getByText("Use the indexed admission.")).toBeVisible();
    } finally {
      await screen.unmount();
    }
  });

  it("hides review controls after a review is complete until editing", async () => {
    const { screen } = await renderReviewSection({ completed: true });

    try {
      await expect.element(page.getByText("Use the indexed admission.")).toBeVisible();
      await expect.element(page.getByLabelText("Reviewer note")).not.toBeInTheDocument();
      await expect.element(page.getByRole("button", { name: "Accept" })).not.toBeInTheDocument();
      await expect
        .element(page.getByRole("button", { name: "Request changes" }))
        .not.toBeInTheDocument();
      await expect.element(page.getByRole("button", { name: "Reject" })).not.toBeInTheDocument();

      await page.getByRole("button", { name: "Edit review" }).click();

      await expect
        .element(page.getByLabelText("Reviewer note"))
        .toHaveValue("Use the indexed admission.");
      await expect.element(page.getByRole("button", { name: "Accept" })).toBeVisible();
      await expect.element(page.getByRole("button", { name: "Request changes" })).toBeVisible();
      await expect.element(page.getByRole("button", { name: "Reject" })).toBeVisible();
    } finally {
      await screen.unmount();
    }
  });

  it("dispatches Accept as a research card review command", async () => {
    const { screen, dispatchCommand } = await renderReviewSection();

    try {
      await page.getByRole("button", { name: "Accept" }).click();

      await vi.waitFor(() => expect(dispatchCommand).toHaveBeenCalledTimes(1));
      const command = latestReviewCommand(dispatchCommand);
      expect(command).toMatchObject({
        type: "session.research-card.review",
        sessionId: SESSION_ID,
        cardId: CARD_ID,
        response: {
          action: "accept",
        },
      });
      expect(command?.type === "session.research-card.review" ? command.createdAt : null).toBe(
        command?.type === "session.research-card.review" ? command.response.timestamp : undefined,
      );
    } finally {
      await screen.unmount();
    }
  });

  it("requires a note before requesting changes", async () => {
    const { screen, dispatchCommand } = await renderReviewSection();

    try {
      await page.getByRole("button", { name: "Request changes" }).click();

      await expect.element(page.getByRole("alert")).toHaveTextContent("Add a note");
      expect(dispatchCommand).not.toHaveBeenCalled();
    } finally {
      await screen.unmount();
    }
  });

  it("dispatches Request changes with the reviewer note", async () => {
    const { screen, dispatchCommand } = await renderReviewSection();

    try {
      await page.getByLabelText("Reviewer note").fill("Recompute after excluding transfers.");
      await page.getByRole("button", { name: "Request changes" }).click();

      await vi.waitFor(() => expect(dispatchCommand).toHaveBeenCalledTimes(1));
      expect(latestReviewCommand(dispatchCommand)).toMatchObject({
        type: "session.research-card.review",
        response: {
          action: "request_changes",
          message: "Recompute after excluding transfers.",
        },
      });
    } finally {
      await screen.unmount();
    }
  });

  it("dispatches Reject with the reviewer note", async () => {
    const { screen, dispatchCommand } = await renderReviewSection();

    try {
      await page.getByLabelText("Reviewer note").fill("Endpoint is not clinically valid.");
      await page.getByRole("button", { name: "Reject" }).click();

      await vi.waitFor(() => expect(dispatchCommand).toHaveBeenCalledTimes(1));
      expect(latestReviewCommand(dispatchCommand)).toMatchObject({
        type: "session.research-card.review",
        response: {
          action: "reject",
          message: "Endpoint is not clinically valid.",
        },
      });
    } finally {
      await screen.unmount();
    }
  });

  it("disables review controls while submit is pending", async () => {
    const pendingDispatch: { resolve: (() => void) | null } = { resolve: null };
    const dispatchCommand = vi.fn(
      () =>
        new Promise<{ sequence: number }>((resolve) => {
          pendingDispatch.resolve = () => resolve({ sequence: 1 });
        }),
    ) as EnvironmentApi["orchestration"]["dispatchCommand"];
    const { screen } = await renderReviewSection({ dispatchCommand });

    try {
      await page.getByLabelText("Reviewer note").fill("Ready to accept.");
      await page.getByRole("button", { name: "Accept" }).click();

      await expect.element(page.getByRole("button", { name: "Accept" })).toBeDisabled();
      await expect.element(page.getByRole("button", { name: "Request changes" })).toBeDisabled();
      await expect.element(page.getByRole("button", { name: "Reject" })).toBeDisabled();
      await expect.element(page.getByLabelText("Reviewer note")).toBeDisabled();

      pendingDispatch.resolve?.();
    } finally {
      await screen.unmount();
    }
  });

  it("shows dispatch errors without clearing the note", async () => {
    const dispatchCommand = vi.fn(async () => {
      throw new Error("Review stream unavailable.");
    }) as EnvironmentApi["orchestration"]["dispatchCommand"];
    const { screen } = await renderReviewSection({ dispatchCommand });

    try {
      await page.getByLabelText("Reviewer note").fill("Fix denominator selection.");
      await page.getByRole("button", { name: "Request changes" }).click();

      await expect.element(page.getByRole("alert")).toHaveTextContent("Review stream unavailable.");
      await expect
        .element(page.getByLabelText("Reviewer note"))
        .toHaveValue("Fix denominator selection.");
    } finally {
      await screen.unmount();
    }
  });
});
