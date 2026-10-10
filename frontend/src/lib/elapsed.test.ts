// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatElapsed, useElapsedSeconds } from './elapsed';

describe('elapsed time label', () => {
  it('stays empty for quick requests', () => {
    expect(formatElapsed(0)).toBe('');
    expect(formatElapsed(1.9)).toBe('');
  });

  it('shows seconds, then minutes and seconds', () => {
    expect(formatElapsed(2)).toBe('2 s');
    expect(formatElapsed(59.7)).toBe('59 s');
    expect(formatElapsed(65)).toBe('1 min 5 s');
    expect(formatElapsed(120)).toBe('2 min 0 s');
  });
});

describe('useElapsedSeconds', () => {
  afterEach(() => vi.useRealTimers());

  it('counts whole seconds while active and resets when it stops', () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ active }) => useElapsedSeconds(active), {
      initialProps: { active: false },
    });
    act(() => void vi.advanceTimersByTime(3000));
    expect(result.current).toBe(0);

    rerender({ active: true });
    act(() => void vi.advanceTimersByTime(2500));
    expect(result.current).toBe(2);

    rerender({ active: false });
    expect(result.current).toBe(0);
  });
});
