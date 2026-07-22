import { describe, expect, it, vi } from "vitest";

import { reserveVitrineBrowserPopup, VITRINE_POPUP_BLOCKED_MESSAGE } from "./vitrineBrowserPopup";

function makePopup() {
  const replace = vi.fn();
  const close = vi.fn();
  const append = vi.fn();
  const replaceChildren = vi.fn();
  const popup = {
    closed: false,
    opener: {} as Window,
    location: { replace },
    close,
    document: {
      title: "",
      createElement: vi.fn((tagName: string) => ({
        tagName,
        name: "",
        content: "",
        textContent: "",
      })),
      head: { append },
      body: { replaceChildren },
    },
  } as unknown as Window;
  return { append, close, popup, replace, replaceChildren };
}

describe("reserveVitrineBrowserPopup", () => {
  it("reserves a safe placeholder and navigates it after validation", () => {
    const { append, close, popup, replace, replaceChildren } = makePopup();
    const openPopup = vi.fn(() => popup);

    const reservation = reserveVitrineBrowserPopup(openPopup);
    reservation.navigate("http://vitrine.localhost:8812/");
    reservation.discard();

    expect(openPopup).toHaveBeenCalledWith("about:blank", "_blank");
    expect(popup.opener).toBeNull();
    expect(append).toHaveBeenCalledOnce();
    expect(replaceChildren).toHaveBeenCalledOnce();
    expect(replace).toHaveBeenCalledWith("http://vitrine.localhost:8812/");
    expect(close).not.toHaveBeenCalled();
  });

  it("closes an unused placeholder", () => {
    const { close, popup } = makePopup();
    reserveVitrineBrowserPopup(() => popup).discard();
    expect(close).toHaveBeenCalledOnce();
  });

  it("fails actionably when the browser blocks the placeholder", () => {
    expect(() => reserveVitrineBrowserPopup(() => null)).toThrow(VITRINE_POPUP_BLOCKED_MESSAGE);
  });
});
