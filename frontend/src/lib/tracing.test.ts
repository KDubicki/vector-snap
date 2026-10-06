import { describe, expect, it } from 'vitest';
import { clampTracingOption, DEFAULT_TRACING, isDefaultTracing } from './tracing';

describe('tracing options', () => {
  it('clamps values into the accepted range', () => {
    expect(clampTracingOption('corner_threshold', 200)).toBe(180);
    expect(clampTracingOption('filter_speckle', -3)).toBe(0);
    expect(clampTracingOption('length_threshold', 1)).toBe(3.5);
    expect(clampTracingOption('path_precision', 12)).toBe(8);
  });

  it('snaps values to the step of the option', () => {
    expect(clampTracingOption('length_threshold', 4.3)).toBe(4.5);
    expect(clampTracingOption('path_precision', 2.6)).toBe(3);
  });

  it('falls back to the default for non-numbers', () => {
    expect(clampTracingOption('splice_threshold', Number.NaN)).toBe(45);
  });

  it('detects whether options differ from the defaults', () => {
    expect(isDefaultTracing({ ...DEFAULT_TRACING })).toBe(true);
    expect(isDefaultTracing({ ...DEFAULT_TRACING, path_precision: 3 })).toBe(false);
    expect(isDefaultTracing({ ...DEFAULT_TRACING, mode: 'polygon' })).toBe(false);
  });
});
