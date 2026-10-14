/**
 * The settings a new Lincei install starts with where upstream's default
 * suits a developer. They are written once per device, when first-run setup
 * reaches Lincei's step, through upstream's own settings writer, which sends
 * the server's keys to the server. After that they are the user's, and the
 * reset arrows in Settings still lead to upstream's defaults.
 */
import type { ClientSettingsPatch, ServerSettingsPatch } from "@t3tools/contracts";

export const RESEARCHER_DEFAULTS = {
  // One stray click would otherwise make a conversation disappear.
  confirmThreadArchive: true,
  // Analyses run long: say so when another conversation finishes or needs an answer.
  inAppNotificationsEnabled: true,
  // "Auto": the agent approves routine steps itself and asks before anything
  // risky. Upstream's default runs every command and edit without asking,
  // on a computer that may hold patient data. Researcher mode hides the
  // picker, so this is the mode a researcher works in.
  defaultRuntimeMode: "auto",
} as const satisfies ServerSettingsPatch & ClientSettingsPatch;

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

/** Gives this device Lincei's starting settings, the first time only, through `update`. */
export function seedResearcherDefaults(
  update: (patch: ServerSettingsPatch & ClientSettingsPatch) => void,
): void {
  seedOnce(window.localStorage, () => update(RESEARCHER_DEFAULTS));
}
