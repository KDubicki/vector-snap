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

/** WCAG relative luminance of a hex color: 0 (black) to 1 (white). */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((value) => {
    const c = value / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Final palette (one hex per index) after applying the user's overrides. */
export function finalPalette(palette: PaletteColor[], overrides: Record<number, string>): string[] {
  return palette.map((color) => (overrides[color.index] ?? color.hex).toLowerCase());
}

/**
 * The candidate closest to `hex` ("redmean" weighted RGB distance, a cheap approximation
 * of perceived difference); `hex` itself when there are no candidates.
 */
export function nearestColor(hex: string, candidates: string[]): string {
  const [r, g, b] = hexToRgb(hex);
  let best = hex;
  let bestDistance = Infinity;
  for (const candidate of candidates) {
    const [cr, cg, cb] = hexToRgb(candidate);
    const mean = (r + cr) / 2;
    const distance =
      (2 + mean / 256) * (r - cr) ** 2 +
      4 * (g - cg) ** 2 +
      (2 + (255 - mean) / 256) * (b - cb) ** 2;
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}
