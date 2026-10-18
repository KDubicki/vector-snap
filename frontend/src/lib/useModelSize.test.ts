// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getModelSize } from '../api/client';
import { MODEL_SIZE_DEBOUNCE_MS, useModelSize } from './useModelSize';

vi.mock('../api/client', () => ({ getModelSize: vi.fn() }));

const SIZE = { x_mm: 100, y_mm: 50, z_mm: 2 };

describe('useModelSize', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(getModelSize).mockReset().mockResolvedValue(SIZE);
  });
  afterEach(() => vi.useRealTimers());

  it('asks once the settings stop changing and drops a stale size', async () => {
    const { result, rerender } = renderHook(
      ({ width }) => useModelSize('<svg/>', { width_mm: width }, true),
      { initialProps: { width: 100 } },
    );
    rerender({ width: 120 });
    expect(result.current).toBeNull();

    await act(() => vi.advanceTimersByTimeAsync(MODEL_SIZE_DEBOUNCE_MS));
    expect(getModelSize).toHaveBeenCalledTimes(1);
    expect(vi.mocked(getModelSize).mock.calls[0][1]).toEqual({ width_mm: 120 });
    expect(result.current).toEqual(SIZE);

    rerender({ width: 90 }); // not asked yet: the old size no longer applies
    expect(result.current).toBeNull();
  });

  it('asks nothing when disabled and forgets a failed request', async () => {
    const { result, rerender } = renderHook(({ enabled }) => useModelSize('<svg/>', {}, enabled), {
      initialProps: { enabled: false },
    });
    await act(() => vi.advanceTimersByTimeAsync(MODEL_SIZE_DEBOUNCE_MS));
    expect(getModelSize).not.toHaveBeenCalled();

    vi.mocked(getModelSize).mockRejectedValue(new Error('offline'));
    rerender({ enabled: true });
    await act(() => vi.advanceTimersByTimeAsync(MODEL_SIZE_DEBOUNCE_MS));
    expect(result.current).toBeNull();
  });
});
