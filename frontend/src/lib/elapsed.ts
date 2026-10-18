import { useEffect, useState } from 'react';

/** Seconds before a running request shows its elapsed time (quick ones never flicker). */
export const ELAPSED_DELAY_S = 2;

/** Elapsed-time label for a long request: '' at first, then "5 s" or "1 min 5 s". */
export function formatElapsed(seconds: number): string {
  if (seconds < ELAPSED_DELAY_S) return '';
  const whole = Math.floor(seconds);
  const minutes = Math.floor(whole / 60);
  return minutes > 0 ? `${minutes} min ${whole % 60} s` : `${whole} s`;
}

/** A longer duration, rounded: "45 s", "8 min", "1 h 5 min". */
export function formatDuration(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (seconds < 60) return `${Math.round(seconds)} s`;
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

/** Whole seconds since `active` became true (0 while inactive), updated every second. */
export function useElapsedSeconds(active: boolean): number {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!active) return;
    const started = Date.now();
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => {
      clearInterval(timer);
      setSeconds(0);
    };
  }, [active]);
  return seconds;
}
