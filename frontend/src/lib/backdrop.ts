/**
 * The editor canvas's background, kept in this browser: a checkerboard shows what is
 * transparent, a plain light or dark one shows white or dark shapes against their opposite.
 */

export const BACKDROPS = ['checker', 'light', 'dark'] as const;
export type Backdrop = (typeof BACKDROPS)[number];

export const BACKDROP_KEY = 'vectorsnap.editor-backdrop';

/** The remembered background; the checkerboard when none (or an unknown one) is stored. */
export function readBackdrop(storage: Pick<Storage, 'getItem'> | undefined): Backdrop {
  try {
    const value = storage?.getItem(BACKDROP_KEY);
    return BACKDROPS.find((backdrop) => backdrop === value) ?? 'checker';
  } catch {
    return 'checker';
  }
}

export function saveBackdrop(
  storage: Pick<Storage, 'setItem'> | undefined,
  backdrop: Backdrop,
): void {
  try {
    storage?.setItem(BACKDROP_KEY, backdrop);
  } catch {
    // Not remembered; the background still changes on this page.
  }
}
