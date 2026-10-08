import { useState } from 'react';
import {
  applyTheme,
  browserStorage,
  readTheme,
  saveTheme,
  type ThemePreference,
} from '../lib/theme';

const ICONS: Record<ThemePreference, string> = {
  // Monitor, sun, moon (24 x 24 strokes).
  system: 'M4 5h16v11H4zM9 20h6M12 16v4',
  light:
    'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  dark: 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z',
};

const LABELS: Record<ThemePreference, string> = {
  system: 'System theme',
  light: 'Light theme',
  dark: 'Dark theme',
};

/** Switch between the system, light and dark color theme (remembered per browser). */
export function ThemeToggle() {
  const [theme, setTheme] = useState<ThemePreference>(() => readTheme(browserStorage()));

  const choose = (value: ThemePreference) => {
    setTheme(value);
    applyTheme(document.documentElement, value);
    saveTheme(browserStorage(), value);
  };

  return (
    <div className="theme-toggle" role="radiogroup" aria-label="Color theme">
      {(Object.keys(ICONS) as ThemePreference[]).map((value) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={theme === value}
          aria-label={LABELS[value]}
          title={LABELS[value]}
          onClick={() => choose(value)}
        >
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path
              d={ICONS[value]}
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      ))}
    </div>
  );
}
