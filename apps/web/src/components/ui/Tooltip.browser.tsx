import "../../index.css";

import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { Tooltip, TooltipPopup, TooltipProvider, TooltipTrigger } from "./tooltip";

describe("Tooltip", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("keeps interactive long-form content pointer-targetable and scrollable", async () => {
    const onAction = vi.fn();
    const screen = await render(
      <TooltipProvider>
        <Tooltip open>
          <TooltipTrigger>Research source</TooltipTrigger>
          <TooltipPopup variant="glass">
            <div className="grid gap-2 p-2">
              <button type="button" onClick={onAction}>
                Open source
              </button>
              <div className="h-12 overflow-y-auto" data-testid="tooltip-scroll-area" tabIndex={0}>
                <div className="h-40">Long source path and metadata</div>
              </div>
            </div>
          </TooltipPopup>
        </Tooltip>
      </TooltipProvider>,
    );

    const action = page.getByRole("button", { name: "Open source" });
    await expect.element(action).toBeInTheDocument();
    expect(getComputedStyle(action.element()).pointerEvents).not.toBe("none");
    await action.click();
    expect(onAction).toHaveBeenCalledOnce();

    const scrollArea = page.getByTestId("tooltip-scroll-area");
    await scrollArea.hover();
    const scrollElement = scrollArea.element();
    expect(scrollElement.scrollHeight).toBeGreaterThan(scrollElement.clientHeight);
    scrollElement.scrollTop = scrollElement.scrollHeight;
    expect(scrollElement.scrollTop).toBeGreaterThan(0);

    await screen.unmount();
  });
});
