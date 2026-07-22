import { useEffect, useRef, useState } from "react";

const TICK_INTERVAL_MS = 120;
const FADE_OUT_DELAY_MS = 220;
const SEED_PERCENT = 4;
const ASYMPTOTE_PERCENT = 90;
const APPROACH_FACTOR = 0.08;
const MIN_INCREMENT = 0.5;

export function useLoadingProgress(loading: boolean): number {
  const [progress, setProgress] = useState(0);
  const progressRef = useRef(0);
  progressRef.current = progress;

  useEffect(() => {
    if (!loading) {
      if (progressRef.current === 0) return;
      setProgress(100);
      const timer = window.setTimeout(() => setProgress(0), FADE_OUT_DELAY_MS);
      return () => window.clearTimeout(timer);
    }

    setProgress((value) => (value > 0 && value < 95 ? value : SEED_PERCENT));
    const interval = window.setInterval(() => {
      const current = progressRef.current;
      if (current >= ASYMPTOTE_PERCENT) return;
      const increment = Math.max(MIN_INCREMENT, (ASYMPTOTE_PERCENT - current) * APPROACH_FACTOR);
      setProgress(Math.min(ASYMPTOTE_PERCENT, current + increment));
    }, TICK_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [loading]);

  return progress;
}
