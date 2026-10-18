import { useEffect, useState } from 'react';
import { getColorChanges, getModelSize } from '../api/client';
import type { ColorChanges, ModelSize } from '../types/api';

/** Wait this long after the last settings change before asking the backend. */
export const BACKEND_RESULT_DEBOUNCE_MS = 500;

type Options = Record<string, string | number | boolean>;
type Load<T> = (svg: string, options: Options, signal: AbortSignal) => Promise<T>;

/**
 * A backend answer for the current SVG and export options, asked for after they stop
 * changing; null while unknown, disabled or after an error (the check is then left out).
 */
export function useBackendResult<T>(
  load: Load<T>,
  svg: string,
  options: Options,
  enabled: boolean,
): T | null {
  const key = JSON.stringify([svg, options]);
  const [result, setResult] = useState<{ key: string; value: T } | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const [currentSvg, currentOptions] = JSON.parse(key) as [string, Options];
    const timer = setTimeout(() => {
      load(currentSvg, currentOptions, controller.signal)
        .then((value) => setResult({ key, value }))
        .catch(() => {
          // Unknown: the export still works without it.
        });
    }, BACKEND_RESULT_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [load, key, enabled]);

  return enabled && result?.key === key ? result.value : null;
}

/** Size of the 3D model (`POST /export/model-size`), for the build volume. */
export function useModelSize(svg: string, options: Options, enabled: boolean): ModelSize | null {
  return useBackendResult(getModelSize, svg, options, enabled);
}

/** Filament changes of a multi-color printer (`POST /export/color-changes`). */
export function useColorChanges(
  svg: string,
  options: Options,
  enabled: boolean,
): ColorChanges | null {
  return useBackendResult(getColorChanges, svg, options, enabled);
}
