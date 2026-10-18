import { SettingsRow } from "~/components/settings/settingsLayout";
import { Button } from "~/components/ui/button";

import { T3_CODE_CREDIT_SETTING } from "./settingsSearchItems";

/**
 * Settings, About: the app Lincei is built on. The brand plugin rebrands
 * "T3 Code" everywhere except in this folder, which is what lets this row name it.
 */
export function T3CodeCredit() {
  return (
    <SettingsRow
      id={T3_CODE_CREDIT_SETTING.id}
      title={T3_CODE_CREDIT_SETTING.title}
      description="Lincei is T3 Code, the open-source app for coding agents by T3 Tools Inc., with a clinical research layer on top. Threads, terminals, diffs, remote access, and every provider come from T3 Code. Thank you to its maintainers and contributors."
      control={
        <Button
          render={
            <a
              href="https://github.com/pingdotgg/t3code"
              target="_blank"
              rel="noreferrer noopener"
            />
          }
          size="sm"
          variant="outline"
        >
          View T3 Code
        </Button>
      }
    />
  );
}
