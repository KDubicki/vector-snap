import { useCallback, useRef, useState } from 'react';
import { errorMessage } from '../api/client';
import { download } from './download';
import { formatElapsed, useElapsedSeconds } from './elapsed';

export interface ExportJob {
  exporting: boolean;
  /** Message of the last failed export (or anything the caller reports via `setError`). */
  error: string | null;
  setError: (error: string | null) => void;
  /** Elapsed-time label while exporting ('' for the first seconds). */
  elapsed: string;
  /** Build a file and download it; a running export is not started twice. */
  run: (build: (signal: AbortSignal) => Promise<Blob>, fileName: string) => Promise<void>;
  /** Abort the running export; it ends without an error. */
  cancel: () => void;
}

/** A cancellable file export with progress (export panel, 3D print step). */
export function useExport(): ExportJob {
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const elapsed = formatElapsed(useElapsedSeconds(exporting));

  const run = useCallback(
    async (build: (signal: AbortSignal) => Promise<Blob>, fileName: string) => {
      if (controller.current) return;
      const current = new AbortController();
      controller.current = current;
      setExporting(true);
      setError(null);
      try {
        const blob = await build(current.signal);
        // Some builds (PNG in the browser) ignore the signal: drop them if cancelled.
        if (!current.signal.aborted) download(blob, fileName);
      } catch (caught) {
        if (!current.signal.aborted) setError(errorMessage(caught, 'Export failed'));
      } finally {
        controller.current = null;
        setExporting(false);
      }
    },
    [],
  );

  const cancel = useCallback(() => controller.current?.abort(), []);

  return { exporting, error, setError, elapsed, run, cancel };
}
