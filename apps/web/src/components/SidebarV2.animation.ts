import { autoAnimate } from "@formkit/auto-animate";

import { SIDEBAR_LIST_ANIMATION_OPTIONS } from "./sidebar/sidebarPresentation";

interface SidebarV2ListAnimationController {
  destroy?: () => void;
}

type SidebarV2ListAnimator = (
  node: HTMLElement,
  options: typeof SIDEBAR_LIST_ANIMATION_OPTIONS,
) => SidebarV2ListAnimationController;

export function createSidebarV2ListAnimationRef(
  animate: SidebarV2ListAnimator = autoAnimate,
): (node: HTMLElement | null) => void {
  let attached:
    | {
        node: HTMLElement;
        controller: SidebarV2ListAnimationController;
      }
    | undefined;

  return (node) => {
    if (attached?.node === node) return;
    attached?.controller.destroy?.();
    attached = undefined;
    if (!node) return;
    attached = {
      node,
      controller: animate(node, SIDEBAR_LIST_ANIMATION_OPTIONS),
    };
  };
}
