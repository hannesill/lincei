import type { ServerConfig } from "@t3tools/contracts";
import type { Atom } from "effect/reactivity";

import { withoutTechieKeybindings } from "./researcherFilters";
import { techieModeAtom } from "./techieMode";

/**
 * The shortcuts that are live in the current mode. Upstream's keybindings atom
 * (state/server.ts) passes its rules through here, so a shortcut to a hidden
 * surface is not registered at all in researcher mode, and labels that show a
 * shortcut lose it with the rule.
 */
export function linceiKeybindings(
  get: Atom.AtomContext,
  rules: ServerConfig["keybindings"],
): ServerConfig["keybindings"] {
  return get(techieModeAtom) ? rules : withoutTechieKeybindings(rules);
}
