import { useEffect, useState } from 'react';
import { onServerBusy } from '../api/client';

/**
 * In how many seconds requests waiting for a busy server are sent again (`503
 * SERVER_BUSY`, retried by the API client), or null when none waits: the page says so
 * instead of showing a spinner for half a minute without a word.
 */
export function useServerBusy(): number | null {
  const [retryIn, setRetryIn] = useState<number | null>(null);
  useEffect(
    () => onServerBusy((waiting, seconds) => setRetryIn(waiting > 0 ? Math.round(seconds) : null)),
    [],
  );
  return retryIn;
}
