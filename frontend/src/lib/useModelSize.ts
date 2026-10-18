import { useEffect, useState } from 'react';
import { getModelSize } from '../api/client';
import type { ModelSize } from '../types/api';

/** Wait this long after the last settings change before asking for the size. */
export const MODEL_SIZE_DEBOUNCE_MS = 500;

/**
 * Size of the 3D model for the current settings (`POST /export/model-size`), asked for
 * after the settings stop changing; null while unknown, disabled or after an error.
 */
export function useModelSize(
  svg: string,
  options: Record<string, string | number | boolean>,
  enabled: boolean,
): ModelSize | null {
  const key = JSON.stringify([svg, options]);
  const [result, setResult] = useState<{ key: string; size: ModelSize } | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const [currentSvg, currentOptions] = JSON.parse(key) as [string, typeof options];
    const timer = setTimeout(() => {
      getModelSize(currentSvg, currentOptions, controller.signal)
        .then((size) => setResult({ key, size }))
        .catch(() => {
          // Unknown size: the check is left out; the export still works.
        });
    }, MODEL_SIZE_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [key, enabled]);

  return enabled && result?.key === key ? result.size : null;
}
