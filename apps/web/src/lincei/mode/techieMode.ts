import { useAtomValue } from "@effect/atom-react";
import { Atom } from "effect/reactivity";

import { appAtomRegistry } from "~/rpc/atomRegistry";

import { TECHIE_ATTRIBUTE, TECHIE_ATTRIBUTE_ON, TECHIE_STORAGE_KEY } from "./attribute";

function paintedMode(): boolean {
  return (
    typeof document !== "undefined" &&
    document.documentElement.getAttribute(TECHIE_ATTRIBUTE) === TECHIE_ATTRIBUTE_ON
  );
}

/**
 * Whether Techie mode is on in this window. It starts from what the boot
 * script painted, so the first render agrees with the stylesheet, and is
 * corrected when the server's stored mode arrives (see techieModeSync.ts).
 */
export const techieModeAtom = Atom.make(paintedMode()).pipe(
  Atom.keepAlive,
  Atom.withLabel("lincei-techie-mode"),
);

/** For code that runs outside React, when it runs: menus, palette filtering. */
export const isTechieMode = (): boolean => appAtomRegistry.get(techieModeAtom);

export const useTechieMode = (): boolean => useAtomValue(techieModeAtom);

/**
 * Makes this window show a mode: the root attribute the researcher-mode
 * stylesheet keys on, the cache the next launch paints from, and everything
 * derived from the atom. Nothing is unmounted or closed, so a terminal or a
 * diff tab that was open comes back as it was when the mode is turned on again.
 */
export function showTechieMode(on: boolean): void {
  if (typeof document !== "undefined") {
    if (on) document.documentElement.setAttribute(TECHIE_ATTRIBUTE, TECHIE_ATTRIBUTE_ON);
    else document.documentElement.removeAttribute(TECHIE_ATTRIBUTE);
  }
  try {
    if (on) localStorage.setItem(TECHIE_STORAGE_KEY, TECHIE_ATTRIBUTE_ON);
    else localStorage.removeItem(TECHIE_STORAGE_KEY);
  } catch {
    // Without storage the mode still holds for this window.
  }
  appAtomRegistry.set(techieModeAtom, on);
}
