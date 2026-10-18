// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getColorChanges, getModelSize } from '../api/client';
import { BACKEND_RESULT_DEBOUNCE_MS, useColorChanges, useModelSize } from './useBackendResult';

vi.mock('../api/client', () => ({ getModelSize: vi.fn(), getColorChanges: vi.fn() }));

const SIZE = { x_mm: 100, y_mm: 50, z_mm: 2 };

describe('useBackendResult', () => {
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

    await act(() => vi.advanceTimersByTimeAsync(BACKEND_RESULT_DEBOUNCE_MS));
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
    await act(() => vi.advanceTimersByTimeAsync(BACKEND_RESULT_DEBOUNCE_MS));
    expect(getModelSize).not.toHaveBeenCalled();

    vi.mocked(getModelSize).mockRejectedValue(new Error('offline'));
    rerender({ enabled: true });
    await act(() => vi.advanceTimersByTimeAsync(BACKEND_RESULT_DEBOUNCE_MS));
    expect(result.current).toBeNull();
  });

  it('asks for the color changes with their options', async () => {
    const changes = {
      layers: 10,
      changes: 9,
      max_colors_per_layer: 2,
      change_time_s: 477,
      purge_mm3: 2034,
      purge_g: 2.52,
    };
    vi.mocked(getColorChanges).mockResolvedValue(changes);
    const { result } = renderHook(() => useColorChanges('<svg/>', { change_s: 53 }, true));

    await act(() => vi.advanceTimersByTimeAsync(BACKEND_RESULT_DEBOUNCE_MS));
    expect(vi.mocked(getColorChanges).mock.calls[0][1]).toEqual({ change_s: 53 });
    expect(result.current).toEqual(changes);
  });
});
