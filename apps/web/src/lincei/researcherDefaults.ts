/**
 * The client settings a new Lincei install starts with where upstream's
 * default suits a developer. They are written once per device, when first-run
 * setup reaches Lincei's step, through upstream's own settings store. After
 * that they are the user's, and the reset arrows in Settings still lead to
 * upstream's defaults.
 */
import type { ClientSettingsPatch } from "@t3tools/contracts";

import { persistClientSettingsPatch } from "~/hooks/useSettings";

export const RESEARCHER_DEFAULTS = {
  // One stray click would otherwise make a conversation disappear.
  confirmThreadArchive: true,
  // Analyses run long: say so when another conversation finishes or needs an answer.
  inAppNotificationsEnabled: true,
} as const satisfies ClientSettingsPatch;

const SEEDED_KEY = "lincei:researcher-defaults";

/**
 * Runs `apply` unless this device was seeded before, and records that it has
 * been. Running setup again must not undo what the user chose since.
 */
export function seedOnce(storage: Pick<Storage, "getItem" | "setItem">, apply: () => void): void {
  try {
    if (storage.getItem(SEEDED_KEY) !== null) return;
  } catch {
    // Storage that cannot be read cannot hold a choice to protect either.
  }
  apply();
  try {
    storage.setItem(SEEDED_KEY, "1");
  } catch {
    // Seeds again the next time setup runs.
  }
}

/** Gives this device Lincei's starting settings, the first time only. */
export function seedResearcherDefaults(): void {
  seedOnce(window.localStorage, () => void persistClientSettingsPatch(RESEARCHER_DEFAULTS));
}
