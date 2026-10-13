import { SettingsRow, SettingsSection } from "~/components/settings/settingsLayout";
import { Switch } from "~/components/ui/switch";

import { useTechieModeSwitch } from "./techieModeSwitch";

/** Ids the settings search entries for the switch point at (linceiSettingsSearch.ts). */
export const TECHIE_MODE_SECTION_ID = "lincei-mode";
export const TECHIE_MODE_ROW_ID = "techie-mode";

/**
 * The one switch between researcher mode and upstream's full feature set,
 * first on Settings, General. It takes effect at once and closes nothing.
 */
export function TechieModeSetting() {
  const [techie, setTechie] = useTechieModeSwitch();
  return (
    <SettingsSection id={TECHIE_MODE_SECTION_ID} title="Mode">
      <SettingsRow
        id={TECHIE_MODE_ROW_ID}
        title="Techie mode"
        description="Show the developer side of Lincei: terminals, file diffs, git branches and worktrees, pull requests, keyboard shortcut editing, and connections to other computers. When off, Lincei shows what a research conversation needs, and agents explain their work in plain language."
        control={<Switch checked={techie} onCheckedChange={setTechie} aria-label="Techie mode" />}
      />
    </SettingsSection>
  );
}
