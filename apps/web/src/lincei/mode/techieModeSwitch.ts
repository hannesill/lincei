import { useCallback } from "react";

import { showTechieMode, useTechieMode } from "./techieMode";

/**
 * The mode and its setter for a control. The window changes at once; the
 * server is told so that agent instructions follow (see techieModeSync.ts).
 */
export function useTechieModeSwitch(): readonly [boolean, (on: boolean) => void] {
  const techie = useTechieMode();
  const setTechie = useCallback((on: boolean) => {
    showTechieMode(on);
  }, []);
  return [techie, setTechie] as const;
}
