/**
 * Color theme preference: follow the system or force light/dark. Stored per browser; the
 * page must render correctly when storage is unavailable (private mode, blocked data).
 */
export type ThemePreference = 'system' | 'light' | 'dark';

export const THEME_STORAGE_KEY = 'vectorsnap.theme';
const THEMES: ThemePreference[] = ['system', 'light', 'dark'];

export function readTheme(storage: Pick<Storage, 'getItem'> | undefined): ThemePreference {
  try {
    const value = storage?.getItem(THEME_STORAGE_KEY);
    return THEMES.includes(value as ThemePreference) ? (value as ThemePreference) : 'system';
  } catch {
    return 'system';
  }
}

export function saveTheme(
  storage: Pick<Storage, 'setItem' | 'removeItem'> | undefined,
  theme: ThemePreference,
): void {
  try {
    if (theme === 'system') storage?.removeItem(THEME_STORAGE_KEY);
    else storage?.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Not remembered; the choice still applies to this page.
  }
}

/** Set `data-theme` on the root element; without it the CSS follows the system. */
export function applyTheme(root: HTMLElement, theme: ThemePreference): void {
  if (theme === 'system') delete root.dataset.theme;
  else root.dataset.theme = theme;
}

/** `localStorage`, or undefined where even accessing it throws. */
export function browserStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}
