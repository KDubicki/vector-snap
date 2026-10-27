/**
 * Keyboard shortcuts of the SVG editor, as the help dialog lists them (`?`). The keys
 * themselves are handled in `SvgEditor`; keep both in step. See
 * docs/08-svg-editor.md#keyboard-shortcuts.
 */

export interface Shortcut {
  /** Key combinations; "Mod" is Cmd on a Mac, Ctrl elsewhere. */
  keys: string[][];
  action: string;
}

export interface ShortcutGroup {
  name: string;
  shortcuts: Shortcut[];
}

export const SHORTCUTS: ShortcutGroup[] = [
  {
    name: 'Tools',
    shortcuts: [
      { keys: [['V']], action: 'Select' },
      { keys: [['H']], action: 'Hand (pan)' },
      { keys: [['K']], action: 'Knife (split along a line)' },
      { keys: [['L']], action: 'Lasso (cut out an area)' },
      { keys: [['Space']], action: 'Pan while held' },
    ],
  },
  {
    name: 'Selection',
    shortcuts: [
      { keys: [['Shift', 'Click']], action: 'Add to the selection' },
      { keys: [['Mod', 'A']], action: 'Select every shape' },
      { keys: [['↑'], ['↓'], ['←'], ['→']], action: 'Nudge by 1 px' },
      { keys: [['Shift', '↑']], action: 'Nudge by 10 px' },
      { keys: [['M']], action: 'Merge the selected shapes' },
      { keys: [['Delete'], ['Backspace']], action: 'Delete the selected shapes' },
      { keys: [['Esc']], action: 'Cancel the action, then clear the selection' },
    ],
  },
  {
    name: 'View',
    shortcuts: [
      { keys: [['+'], ['−']], action: 'Zoom in, out' },
      { keys: [['0']], action: 'Fit the design' },
    ],
  },
  {
    name: 'File and history',
    shortcuts: [
      { keys: [['Mod', 'Z']], action: 'Undo' },
      {
        keys: [
          ['Mod', 'Shift', 'Z'],
          ['Ctrl', 'Y'],
        ],
        action: 'Redo',
      },
      { keys: [['Mod', 'S']], action: 'Download the SVG' },
      { keys: [['?']], action: 'Show these shortcuts' },
    ],
  },
];

/** True on a Mac, where "Mod" is Cmd. */
export function isMac(platform = typeof navigator === 'undefined' ? '' : navigator.platform) {
  return /Mac|iPhone|iPad/.test(platform);
}

/** A key as printed on this keyboard. */
export function keyLabel(key: string, mac = isMac()): string {
  if (key === 'Mod') return mac ? '⌘' : 'Ctrl';
  if (key === 'Shift' && mac) return '⇧';
  return key;
}
