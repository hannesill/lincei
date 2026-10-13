import type { EnvironmentId } from "@t3tools/contracts";
import { useCallback, useEffect } from "react";

import { usePrimaryEnvironmentId } from "~/state/environments";
import { useAtomCommand } from "~/state/use-atom-command";

import { linceiCommand } from "../linceiRequests";
import { showTechieMode, useTechieMode } from "./techieMode";

/**
 * Counts changes made in this window, so an answer that was asked for before
 * the user flipped the switch cannot flip it back.
 */
let localChanges = 0;

/**
 * Brings this window in line with the mode the server has stored. The server
 * is the one place the mode lives, because it decides what agents are told;
 * the window only caches it to paint the right thing at launch. Surfaces that
 * are on screen for long call this: the thread header and the settings row.
 */
export function useTechieModeSync(environmentId: EnvironmentId | null): void {
  const request = useAtomCommand(linceiCommand, { reportFailure: false });
  useEffect(() => {
    if (environmentId === null) return;
    const askedAt = localChanges;
    let stopped = false;
    void request({ environmentId, input: { _tag: "Preferences" } }).then((answer) => {
      if (stopped || askedAt !== localChanges) return;
      // A server that is not Lincei, or one that cannot be reached, leaves the cached mode.
      if (answer._tag !== "Success" || answer.value._tag !== "Preferences") return;
      showTechieMode(answer.value.preferences.techieMode);
    });
    return () => {
      stopped = true;
    };
  }, [environmentId, request]);
}

/**
 * The mode and its setter for a control. The window changes at once and
 * nothing is closed; the server is told so that agents follow from their next
 * turn.
 */
export function useTechieModeSwitch(): readonly [boolean, (on: boolean) => void] {
  const techie = useTechieMode();
  const environmentId = usePrimaryEnvironmentId();
  const request = useAtomCommand(linceiCommand, { reportFailure: false });
  useTechieModeSync(environmentId);
  const setTechie = useCallback(
    (on: boolean) => {
      localChanges += 1;
      showTechieMode(on);
      if (environmentId === null) return;
      void request({ environmentId, input: { _tag: "PreferencesUpdate", techieMode: on } });
    },
    [environmentId, request],
  );
  return [techie, setTechie] as const;
}
