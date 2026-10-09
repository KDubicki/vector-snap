import { describe, expect, it } from 'vitest';
import { formatElapsed } from './elapsed';

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
