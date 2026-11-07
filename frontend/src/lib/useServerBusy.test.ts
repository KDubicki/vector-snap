// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { suggestColors } from '../api/client';
import { useServerBusy } from './useServerBusy';

function busy() {
  return new Response(
    JSON.stringify({ error: { code: 'SERVER_BUSY', message: 'Busy.', details: {} } }),
    { status: 503, headers: { 'Retry-After': '5' } },
  );
}

describe('useServerBusy', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('says when a request waits for the busy server, until it went through', async () => {
    vi.useFakeTimers();
    const answer = new Response(JSON.stringify({ colors: 4, target_delta_e: 5, errors: [] }));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(busy()).mockResolvedValueOnce(answer));
    const { result } = renderHook(() => useServerBusy());
    expect(result.current).toBeNull();

    let suggestion: Promise<unknown> = Promise.resolve();
    await act(async () => {
      suggestion = suggestColors(new Blob(['img']));
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(result.current).toBe(5);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
      await suggestion;
    });
    expect(result.current).toBeNull();
  });
});
