// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cancelRevoke, scheduleRevoke, useObjectUrl } from './useObjectUrl';

describe('object URL revocation', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('revokes a released URL after one tick', () => {
    vi.useFakeTimers();
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);

    scheduleRevoke('blob:a');
    expect(revoke).not.toHaveBeenCalled();
    vi.runAllTimers();

    expect(revoke).toHaveBeenCalledWith('blob:a');
  });

  it('keeps a URL that is re-mounted before the tick (StrictMode)', () => {
    vi.useFakeTimers();
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);

    scheduleRevoke('blob:b');
    cancelRevoke('blob:b');
    vi.runAllTimers();

    expect(revoke).not.toHaveBeenCalled();
  });
});

describe('useObjectUrl', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('creates a URL per blob and revokes it when replaced or unmounted', () => {
    vi.useFakeTimers();
    let next = 0;
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:${(next += 1)}`);
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const first = new Blob(['a']);
    const { result, rerender, unmount } = renderHook(({ blob }) => useObjectUrl(blob), {
      initialProps: { blob: first as Blob | null },
    });
    expect(result.current).toBe('blob:1');

    rerender({ blob: first });
    expect(result.current).toBe('blob:1'); // same blob, same URL
    rerender({ blob: new Blob(['b']) });
    expect(result.current).toBe('blob:2');
    vi.runAllTimers();
    expect(revoke).toHaveBeenCalledWith('blob:1');

    rerender({ blob: null });
    expect(result.current).toBeNull();
    unmount();
    vi.runAllTimers();
    expect(revoke).toHaveBeenCalledWith('blob:2');
  });
});
