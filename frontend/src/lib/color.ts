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

/** Linear light (0–1) of an sRGB channel (0–255). */
export function srgbToLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance of a hex color: 0 (black) to 1 (white). */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map(srgbToLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export type Lab = [number, number, number];

/** CIE L*a*b* (D65) of a hex color. */
export function toLab(hex: string): Lab {
  const [r, g, b] = hexToRgb(hex).map(srgbToLinear);
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (841 / 108) * t + 4 / 29);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

/** Color difference (CIE76 ΔE): about 2.3 is just noticeable, above 10 clearly different. */
export function deltaE(a: string, b: string): number {
  const [l1, a1, b1] = toLab(a);
  const [l2, a2, b2] = toLab(b);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
const toDegrees = (radians: number) => (radians * 180) / Math.PI;

/**
 * Perceived color difference (CIEDE2000). Unlike CIE76 it corrects for the eye being less
 * sensitive to differences in saturated colors and more to blue hues, so one threshold
 * means "looks alike" across the whole gamut: below ~2 the same, below ~8 near-duplicates.
 */
export function deltaE2000(first: string, second: string): number {
  return labDeltaE2000(toLab(first), toLab(second));
}

/** CIEDE2000 of two L*a*b* colors (Sharma, Wu & Dalal 2005). */
export function labDeltaE2000([l1, a1, b1]: Lab, [l2, a2, b2]: Lab): number {
  const chroma = (Math.hypot(a1, b1) + Math.hypot(a2, b2)) / 2;
  const g = 0.5 * (1 - Math.sqrt(chroma ** 7 / (chroma ** 7 + 25 ** 7)));
  const a1p = a1 * (1 + g);
  const a2p = a2 * (1 + g);
  const c1 = Math.hypot(a1p, b1);
  const c2 = Math.hypot(a2p, b2);
  const hue = (b: number, a: number) =>
    b === 0 && a === 0 ? 0 : (toDegrees(Math.atan2(b, a)) + 360) % 360;
  const h1 = hue(b1, a1p);
  const h2 = hue(b2, a2p);

  const dL = l2 - l1;
  const dC = c2 - c1;
  let dh = 0;
  if (c1 * c2 !== 0) {
    dh = h2 - h1;
    if (dh > 180) dh -= 360;
    else if (dh < -180) dh += 360;
  }
  const dH = 2 * Math.sqrt(c1 * c2) * Math.sin(toRadians(dh / 2));

  const lMean = (l1 + l2) / 2;
  const cMean = (c1 + c2) / 2;
  let hMean = h1 + h2;
  if (c1 * c2 !== 0) {
    hMean = Math.abs(h1 - h2) > 180 ? (h1 + h2 + 360) / 2 : (h1 + h2) / 2;
    if (hMean >= 360) hMean -= 360;
  }
  const t =
    1 -
    0.17 * Math.cos(toRadians(hMean - 30)) +
    0.24 * Math.cos(toRadians(2 * hMean)) +
    0.32 * Math.cos(toRadians(3 * hMean + 6)) -
    0.2 * Math.cos(toRadians(4 * hMean - 63));
  const sl = 1 + (0.015 * (lMean - 50) ** 2) / Math.sqrt(20 + (lMean - 50) ** 2);
  const sc = 1 + 0.045 * cMean;
  const sh = 1 + 0.015 * cMean * t;
  const rotation =
    -2 *
    Math.sqrt(cMean ** 7 / (cMean ** 7 + 25 ** 7)) *
    Math.sin(toRadians(60 * Math.exp(-(((hMean - 275) / 25) ** 2))));
  return Math.sqrt(
    (dL / sl) ** 2 + (dC / sc) ** 2 + (dH / sh) ** 2 + rotation * (dC / sc) * (dH / sh),
  );
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
