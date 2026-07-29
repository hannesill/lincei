import { autoAnimate } from "@formkit/auto-animate";

import { SIDEBAR_LIST_ANIMATION_OPTIONS } from "./sidebar/sidebarPresentation";

type SidebarV2ListAnimator = (
  node: HTMLElement,
  options: typeof SIDEBAR_LIST_ANIMATION_OPTIONS,
) => unknown;

export function attachSidebarV2ListAnimation(
  node: HTMLElement | null,
  animatedLists: WeakSet<HTMLElement>,
  animate: SidebarV2ListAnimator = autoAnimate,
): void {
  if (!node || animatedLists.has(node)) return;
  animate(node, SIDEBAR_LIST_ANIMATION_OPTIONS);
  animatedLists.add(node);
}
