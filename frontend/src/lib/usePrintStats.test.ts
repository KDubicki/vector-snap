// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getColorChanges, getModelSize } from '../api/client';
import { printerById } from './printers';
import { BACKEND_RESULT_DEBOUNCE_MS } from './useBackendResult';
import { filamentUse, usePrintStats } from './usePrintStats';

vi.mock('../api/client', () => ({ getModelSize: vi.fn(), getColorChanges: vi.fn() }));

const CHANGES = {
  filaments: [
    { color: '#ffffff', volume_mm3: 4000, grams: 4.96 },
    { color: '#ff0000', volume_mm3: 500, grams: 0.62 },
  ],
  layers: 12,
  changes: 3,
  max_colors_per_layer: 2,
  change_time_s: 159,
  purge_mm3: 678,
  purge_g: 0.84,
};

describe('print stats', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(getModelSize).mockReset().mockResolvedValue({ x_mm: 80, y_mm: 60, z_mm: 2.4 });
    vi.mocked(getColorChanges).mockReset().mockResolvedValue(CHANGES);
  });
  afterEach(() => vi.useRealTimers());

  it('numbers the colors in 3MF filament order and adds up their grams', () => {
    const use = filamentUse(CHANGES);

    expect([...use.slots]).toEqual([
      ['#ffffff', 1],
      ['#ff0000', 2],
    ]);
    expect(use.grams.get('#ff0000')).toBe(0.62);
    expect(use.totalGrams).toBeCloseTo(5.58);
    expect(filamentUse(null)).toEqual({
      grams: new Map(),
      slots: new Map(),
      totalGrams: undefined,
    });
  });

  it("asks for the size and the printer's color changes", async () => {
    const kobra = printerById('kobra-x');
    const { result } = renderHook(() => usePrintStats('<svg/>', { width_mm: 80 }, kobra, true));
    await act(() => vi.advanceTimersByTimeAsync(BACKEND_RESULT_DEBOUNCE_MS));

    expect(vi.mocked(getModelSize).mock.calls[0][1]).toEqual({ width_mm: 80 });
    expect(vi.mocked(getColorChanges).mock.calls[0][1]).toEqual({
      width_mm: 80,
      change_s: kobra.changeS,
      purge_mm3: kobra.purgeMm3,
    });
    expect(result.current.size).toEqual({ x_mm: 80, y_mm: 60, z_mm: 2.4 });
    expect(result.current.slots.get('#ff0000')).toBe(2);
  });
});
