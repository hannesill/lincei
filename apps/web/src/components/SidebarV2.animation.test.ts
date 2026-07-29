import { describe, expect, it, vi } from "vitest";

import { createSidebarV2ListAnimationRef } from "./SidebarV2.animation";
import { SIDEBAR_LIST_ANIMATION_OPTIONS } from "./sidebar/sidebarPresentation";

describe("Sidebar v2 list animation", () => {
  it("destroys the controller on cleanup before attaching a remounted row parent", () => {
    const firstList = {} as HTMLUListElement;
    const secondList = {} as HTMLUListElement;
    const firstDestroy = vi.fn();
    const secondDestroy = vi.fn();
    const animate = vi
      .fn()
      .mockReturnValueOnce({ destroy: firstDestroy })
      .mockReturnValueOnce({ destroy: secondDestroy });
    const attachList = createSidebarV2ListAnimationRef(animate);

    attachList(firstList);
    attachList(firstList);
    attachList(null);
    attachList(secondList);
    attachList(null);

    expect(animate.mock.calls).toEqual([
      [firstList, SIDEBAR_LIST_ANIMATION_OPTIONS],
      [secondList, SIDEBAR_LIST_ANIMATION_OPTIONS],
    ]);
    expect(firstDestroy).toHaveBeenCalledTimes(1);
    expect(secondDestroy).toHaveBeenCalledTimes(1);
  });
});
