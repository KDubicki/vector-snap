import { describe, expect, it } from 'vitest';
import { BACKDROP_KEY, readBackdrop, saveBackdrop } from './backdrop';

const memory = (value: string | null = null) => {
  const items = new Map<string, string>(value === null ? [] : [[BACKDROP_KEY, value]]);
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, next: string) => void items.set(key, next),
  };
};

describe('backdrop', () => {
  it('remembers the chosen background', () => {
    const storage = memory();
    saveBackdrop(storage, 'dark');

    expect(readBackdrop(storage)).toBe('dark');
  });

  it('falls back to the checkerboard', () => {
    expect(readBackdrop(memory())).toBe('checker');
    expect(readBackdrop(memory('purple'))).toBe('checker');
    expect(readBackdrop(undefined)).toBe('checker');
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
    };
    expect(readBackdrop(broken)).toBe('checker');
  });

  it('ignores storage that refuses to save', () => {
    const full = {
      setItem: () => {
        throw new Error('quota');
      },
    };
    expect(() => saveBackdrop(full, 'light')).not.toThrow();
  });
});
