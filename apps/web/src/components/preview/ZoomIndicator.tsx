import { useEffect, useRef, useState } from "react";

import { cn } from "~/lib/utils";

export function ZoomIndicator({ zoomFactor }: { zoomFactor: number }) {
  const [visible, setVisible] = useState(false);
  const lastFactorRef = useRef(zoomFactor);
  useEffect(() => {
    if (Math.abs(lastFactorRef.current - zoomFactor) < 0.001) return;
    lastFactorRef.current = zoomFactor;
    setVisible(true);
    const timer = window.setTimeout(() => setVisible(false), 1_500);
    return () => window.clearTimeout(timer);
  }, [zoomFactor]);
  return (
    <div
      aria-hidden={!visible}
      className={cn(
        "pointer-events-none absolute right-3 top-3 z-20 select-none rounded-full border border-border/70 bg-popover/95 px-2.5 py-1 text-xs font-medium shadow-md/10 transition-all",
        visible ? "translate-y-0 opacity-100" : "-translate-y-1 opacity-0",
      )}
    >
      {Math.round(zoomFactor * 100)}%
    </div>
  );
}
