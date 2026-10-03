import type { PaletteColor } from '../types/api';

export type Rgb = [number, number, number];

const HEX_RE = /^#[0-9a-f]{6}$/i;

export function isHexColor(value: string): boolean {
  return HEX_RE.test(value);
}

export function hexToRgb(hex: string): Rgb {
  if (!isHexColor(hex)) throw new Error(`Invalid hex color: ${hex}`);
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as Rgb;
}

export function rgbToHex([r, g, b]: Rgb): string {
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/** Final palette (one hex per index) after applying the user's overrides. */
export function finalPalette(palette: PaletteColor[], overrides: Record<number, string>): string[] {
  return palette.map((color) => (overrides[color.index] ?? color.hex).toLowerCase());
}
