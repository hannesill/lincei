import "../../index.css";

import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { useState } from "react";

import { type ComposerCommandItem, ComposerCommandMenu } from "./ComposerCommandMenu";
import { ComposerCommandMenuLayer } from "./ComposerCommandMenuLayer";

const MENU_ITEMS: ComposerCommandItem[] = Array.from({ length: 24 }, (_, index) => ({
  id: `path:${index}`,
  type: "path",
  path: `/research/source-${index}.md`,
  pathKind: "file",
  label: `source-${index}.md`,
  description: "Research source",
}));

function ShortViewportComposerMenu() {
  const [anchor, setAnchor] = useState<HTMLDivElement | null>(null);

  return (
    <>
      <div
        ref={setAnchor}
        data-testid="composer-menu-anchor"
        className="fixed left-6 top-[120px] h-10 w-80"
      />
      <ComposerCommandMenuLayer anchor={anchor}>
        <ComposerCommandMenu
          items={MENU_ITEMS}
          resolvedTheme="light"
          isLoading={false}
          triggerKind="path"
          activeItemId={MENU_ITEMS[0]?.id ?? null}
          onHighlightedItemChange={() => undefined}
          onSelect={() => undefined}
        />
      </ComposerCommandMenuLayer>
    </>
  );
}

describe("ComposerCommandMenuLayer", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("constrains and scrolls the command list in short available space", async () => {
    const screen = await render(<ShortViewportComposerMenu />);
    const anchor = page.getByTestId("composer-menu-anchor");

    const layer = await vi.waitFor(() => {
      const element = document.querySelector<HTMLElement>('[data-chat-composer-menu-layer="true"]');
      expect(element).not.toBeNull();
      return element!;
    });
    const scrollViewport = await vi.waitFor(() => {
      const element = layer.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]');
      expect(element).not.toBeNull();
      expect(element!.scrollHeight).toBeGreaterThan(element!.clientHeight);
      return element!;
    });

    const layerRect = layer.getBoundingClientRect();
    const anchorRect = anchor.element().getBoundingClientRect();
    expect(layerRect.height).toBeLessThanOrEqual(96);
    expect(layerRect.top).toBeGreaterThanOrEqual(16);
    expect(layerRect.bottom).toBeLessThanOrEqual(anchorRect.top - 8);

    scrollViewport.scrollTop = scrollViewport.scrollHeight;
    await vi.waitFor(() => {
      expect(scrollViewport.scrollTop).toBeGreaterThan(0);
    });

    await screen.unmount();
  });
});
