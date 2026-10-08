// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { THEME_STORAGE_KEY, applyTheme, readTheme, saveTheme } from './theme';

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  };
}

const broken = {
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('blocked');
  },
  removeItem: () => {
    throw new Error('blocked');
  },
};

describe('theme preference', () => {
  it('reads a stored theme and falls back to the system theme', () => {
    expect(readTheme(memoryStorage({ [THEME_STORAGE_KEY]: 'dark' }))).toBe('dark');
    expect(readTheme(memoryStorage({ [THEME_STORAGE_KEY]: 'purple' }))).toBe('system');
    expect(readTheme(memoryStorage())).toBe('system');
    expect(readTheme(undefined)).toBe('system');
    expect(readTheme(broken)).toBe('system');
  });

  it('stores explicit themes and forgets the system choice', () => {
    const storage = memoryStorage();

    saveTheme(storage, 'light');
    expect(storage.values.get(THEME_STORAGE_KEY)).toBe('light');
    saveTheme(storage, 'system');
    expect(storage.values.has(THEME_STORAGE_KEY)).toBe(false);
    expect(() => saveTheme(broken, 'dark')).not.toThrow();
  });

  it('sets or clears data-theme on the root element', () => {
    const root = document.createElement('html');

    applyTheme(root, 'dark');
    expect(root.dataset.theme).toBe('dark');
    applyTheme(root, 'system');
    expect(root.hasAttribute('data-theme')).toBe(false);
  });
});
