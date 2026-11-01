import type { StateCreator } from 'zustand';
import type { AppState } from './store';

/** Edits of the reduced palette before tracing (docs/07-frontend.md#step-2--colors). */
export interface PaletteSlice {
  /** Colors that must appear exactly in the palette (FR-16); at most `colors` of them. */
  locked: string[];
  overrides: Record<number, string>;
  /** Palette indices left out of the SVG everywhere. */
  transparent: number[];
  /**
   * Removed background: palette index left out only where it reaches the image border,
   * so the same color inside the motif stays; null = kept.
   */
  background: number | null;

  /** Lock a color into the palette; ignored when it is locked already or no slot is free. */
  lockColor: (hex: string) => void;
  unlockColor: (hex: string) => void;
  setOverride: (index: number, hex: string) => void;
  resetOverride: (index: number) => void;
  resetOverrides: () => void;
  /** Toggle whether a palette color is left out; at least one color always stays. */
  toggleTransparent: (index: number) => void;
  setBackground: (index: number | null) => void;
}

export const initialPaletteState: Pick<
  PaletteSlice,
  'locked' | 'overrides' | 'transparent' | 'background'
> = {
  locked: [],
  overrides: {},
  transparent: [],
  background: null,
};

export const createPaletteSlice: StateCreator<AppState, [], [], PaletteSlice> = (set) => ({
  ...initialPaletteState,

  lockColor: (hex) =>
    set((state) => {
      const color = hex.toLowerCase();
      if (state.locked.includes(color) || state.locked.length >= state.colors) return {};
      return { locked: [...state.locked, color] };
    }),
  unlockColor: (hex) =>
    set((state) => {
      const color = hex.toLowerCase();
      return state.locked.includes(color)
        ? { locked: state.locked.filter((locked) => locked !== color) }
        : {};
    }),

  setOverride: (index, hex) =>
    set((state) => ({ overrides: { ...state.overrides, [index]: hex.toLowerCase() } })),
  resetOverride: (index) =>
    set((state) => {
      const overrides = { ...state.overrides };
      delete overrides[index];
      return { overrides };
    }),
  resetOverrides: () => set({ overrides: {} }),

  toggleTransparent: (index) =>
    set((state) => {
      if (state.transparent.includes(index)) {
        return { transparent: state.transparent.filter((value) => value !== index) };
      }
      const colors = state.quantized?.palette.length ?? 0;
      if (state.transparent.length + 1 >= colors) return {};
      return { transparent: [...state.transparent, index].sort((a, b) => a - b) };
    }),

  setBackground: (background) => set({ background }),
});
