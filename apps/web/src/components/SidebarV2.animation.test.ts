import { describe, expect, it, vi } from "vitest";

import { attachSidebarV2ListAnimation } from "./SidebarV2.animation";
import { SIDEBAR_LIST_ANIMATION_OPTIONS } from "./sidebar/sidebarPresentation";

describe("Sidebar v2 list animation", () => {
  it("attaches once to the actual row parent", () => {
    const list = {} as HTMLUListElement;
    const animatedLists = new WeakSet<HTMLElement>();
    const animate = vi.fn();

    attachSidebarV2ListAnimation(list, animatedLists, animate);
    attachSidebarV2ListAnimation(list, animatedLists, animate);

    expect(animate).toHaveBeenCalledTimes(1);
    expect(animate).toHaveBeenCalledWith(list, SIDEBAR_LIST_ANIMATION_OPTIONS);
  });
});
