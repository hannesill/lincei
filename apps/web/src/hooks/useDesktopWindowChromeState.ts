import { type DesktopWindowChromeState } from "@t3tools/contracts";
import { useEffect, useState } from "react";

import { isElectron } from "../env";

export function useDesktopWindowChromeState(): DesktopWindowChromeState {
  const [state, setState] = useState<DesktopWindowChromeState>({ isFullScreen: false });

  useEffect(() => {
    if (!isElectron) return;
    const bridge = window.desktopBridge;
    if (!bridge) return;

    let disposed = false;
    const statePromise = bridge.getWindowChromeState?.();
    void statePromise
      ?.then((nextState) => {
        if (!disposed && nextState) {
          setState(nextState);
        }
      })
      .catch(() => undefined);

    const unsubscribe = bridge.onWindowChromeState?.((nextState) => {
      setState(nextState);
    });

    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, []);

  return state;
}
