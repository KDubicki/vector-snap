import { useEffect, useMemo } from 'react';

// Revocations wait one tick so a URL that is immediately re-mounted (React StrictMode runs
// effect cleanup + setup twice in development) is not revoked while still in use.
const pendingRevocations = new Map<string, ReturnType<typeof setTimeout>>();

export function scheduleRevoke(url: string): void {
  pendingRevocations.set(
    url,
    setTimeout(() => {
      pendingRevocations.delete(url);
      URL.revokeObjectURL(url);
    }, 0),
  );
}

export function cancelRevoke(url: string): void {
  clearTimeout(pendingRevocations.get(url));
  pendingRevocations.delete(url);
}

/** Object URL for a Blob, revoked when the blob changes or the component unmounts. */
export function useObjectUrl(blob: Blob | null): string | null {
  // Derived during render: no state, so no setState inside an effect.
  const url = useMemo(() => (blob ? URL.createObjectURL(blob) : null), [blob]);

  useEffect(() => {
    if (!url) return;
    cancelRevoke(url);
    return () => scheduleRevoke(url);
  }, [url]);

  return url;
}
