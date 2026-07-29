import "../index.css";

import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

function SidebarContrastSamples() {
  return (
    <>
      <div
        className="border border-sidebar-border bg-sidebar text-sidebar-foreground"
        data-sidebar-implementation="v1"
        data-testid="sidebar-v1"
      >
        Sidebar v1
      </div>
      <div
        className="border border-sidebar-border bg-sidebar text-sidebar-foreground"
        data-sidebar-implementation="v2"
        data-testid="sidebar-v2"
      >
        Sidebar v2
      </div>
    </>
  );
}

function readSurface(element: Element) {
  const style = getComputedStyle(element);
  return {
    background: style.backgroundColor,
    border: style.borderTopColor,
    foreground: style.color,
  };
}

describe("App sidebar contrast", () => {
  afterEach(() => {
    document.documentElement.classList.remove("dark");
    document.body.innerHTML = "";
  });

  it("shares an opaque semantic palette across v1 rollback and v2", async () => {
    const screen = await render(<SidebarContrastSamples />);
    const v1 = screen.getByTestId("sidebar-v1").element();
    const v2 = screen.getByTestId("sidebar-v2").element();
    const lightV1 = readSurface(v1);
    const lightV2 = readSurface(v2);

    expect(lightV1).toEqual(lightV2);
    expect(lightV1.background).not.toBe("rgba(0, 0, 0, 0)");
    expect(lightV1.foreground).not.toBe(lightV1.background);
    expect(lightV1.border).not.toBe("rgba(0, 0, 0, 0)");

    document.documentElement.classList.add("dark");

    await vi.waitFor(() => {
      const darkV1 = readSurface(v1);
      const darkV2 = readSurface(v2);
      expect(darkV1).toEqual(darkV2);
      expect(darkV1.background).not.toBe(lightV1.background);
      expect(darkV1.foreground).not.toBe(darkV1.background);
      expect(darkV1.border).not.toBe("rgba(0, 0, 0, 0)");
    });

    await screen.unmount();
  });

  it("keeps the settings scrollbar outside the decorative top fade", async () => {
    const screen = await render(
      <div className="settings-page-scroll-fade h-24 overflow-y-auto" data-testid="settings-scroll">
        <div className="h-96">Scrollable settings</div>
      </div>,
    );
    const style = getComputedStyle(screen.getByTestId("settings-scroll").element());

    expect(Number.parseFloat(style.scrollPaddingTop)).toBeGreaterThan(0);
    expect(style.maskPosition.split(",")).toHaveLength(3);
    expect(style.maskSize.split(",")).toHaveLength(3);
    expect(style.maskSize.split(",").at(-1)).toContain("6px");

    await screen.unmount();
  });
});
