import { SettingsRow, SettingsSection } from "~/components/settings/settingsLayout";
import { Switch } from "~/components/ui/switch";

import { TECHIE_MODE_SETTING } from "../settingsSearchItems";
import { useTechieModeSwitch } from "./techieModeSwitch";

/**
 * The one switch between researcher mode and upstream's full feature set,
 * first on Settings, General. It takes effect at once and closes nothing.
 */
export function TechieModeSetting() {
  const [techie, setTechie] = useTechieModeSwitch();
  return (
    <SettingsSection id="lincei-mode" title="Mode">
      <SettingsRow
        id={TECHIE_MODE_SETTING.id}
        title={TECHIE_MODE_SETTING.title}
        description="Show the developer side of Lincei: terminals, file diffs, git branches and worktrees, pull requests, keyboard shortcut editing, and connections to other computers. When off, Lincei shows what a research conversation needs, and agents explain their work in plain language."
        control={
          <Switch
            checked={techie}
            onCheckedChange={setTechie}
            aria-label={TECHIE_MODE_SETTING.title}
          />
        }
      />
    </SettingsSection>
  );
}
