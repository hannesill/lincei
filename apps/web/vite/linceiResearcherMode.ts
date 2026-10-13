import type { HtmlTagDescriptor } from "vite-plus";

import {
  TECHIE_ATTRIBUTE,
  TECHIE_ATTRIBUTE_ON,
  TECHIE_STORAGE_KEY,
} from "../src/lincei/mode/attribute.ts";

/**
 * A developer control that is hidden unless Techie mode is on.
 *
 * Upstream has few test ids, so most selectors lean on an aria-label or a
 * data attribute that upstream may reword. `anchors` is the source text each
 * selector depends on: `node scripts/lincei/identity.ts check` fails when one
 * is gone. At run time a selector that no longer matches hides nothing, so a
 * broken rule means the control reappears, never that something else
 * disappears.
 */
export interface HiddenControl {
  readonly what: string;
  readonly selector: string;
  readonly anchors: ReadonlyArray<{ readonly file: string; readonly text: string }>;
}

export const HIDDEN_UNLESS_TECHIE: ReadonlyArray<HiddenControl> = [];

const RESEARCHER_ROOT = `html:not([${TECHIE_ATTRIBUTE}="${TECHIE_ATTRIBUTE_ON}"])`;

/** One rule per control, outside any cascade layer so it wins over upstream's layered styles. */
export function researcherModeStylesheet(
  controls: ReadonlyArray<HiddenControl> = HIDDEN_UNLESS_TECHIE,
): string {
  return controls
    .map(
      (control) =>
        `/* ${control.what} */\n${RESEARCHER_ROOT} ${control.selector} { display: none !important; }`,
    )
    .join("\n");
}

/** Sets the root attribute from the cached mode before anything paints. */
const BOOT_SCRIPT = `try{if(localStorage.getItem(${JSON.stringify(TECHIE_STORAGE_KEY)})===${JSON.stringify(TECHIE_ATTRIBUTE_ON)})document.documentElement.setAttribute(${JSON.stringify(TECHIE_ATTRIBUTE)},${JSON.stringify(TECHIE_ATTRIBUTE_ON)})}catch{}`;

export function researcherModeHeadTags(): Array<HtmlTagDescriptor> {
  return [
    { tag: "script", children: BOOT_SCRIPT, injectTo: "head-prepend" },
    {
      tag: "style",
      attrs: { id: "lincei-researcher-mode" },
      children: researcherModeStylesheet(),
      injectTo: "head",
    },
  ];
}
