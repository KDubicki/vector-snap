/**
 * 3D printing advice for a quantized palette: every color is a filament (an AMS slot,
 * filament changes and purge waste), so near-duplicate shades and tiny areas are worth
 * merging, and colors can be replaced by the nearest real filaments.
 * See docs/07-frontend.md#step-2--colors--palette.
 */
import { deltaE2000 } from './color';
import type { LibraryFilament } from './filamentLibrary';

export interface PaletteEntry {
  index: number;
  /** Final color (after overrides). */
  hex: string;
  /** Share of the opaque image, 0–1. */
  coverage: number;
}

/** CIEDE2000 below this: the two colors look nearly identical. */
export const NEAR_DUPLICATE_DELTA_E = 8;
/** CIEDE2000 below this: similar shades that could share one filament. */
export const SIMILAR_DELTA_E = 16;
/** Colors covering less of the image than this rarely justify a filament. */
export const TINY_COVERAGE = 0.005;
export const MAX_SUGGESTIONS = 4;

export interface MergeSuggestion {
  /** The larger color, kept. */
  keep: PaletteEntry;
  /** The smaller color, recolored to `keep`. */
  merge: PaletteEntry;
  delta: number;
}

/** The distinct colors among `entries` (merged colors count once, with their coverage). */
function distinct(entries: PaletteEntry[]): PaletteEntry[] {
  const byHex = new Map<string, PaletteEntry>();
  for (const entry of entries) {
    const known = byHex.get(entry.hex);
    if (!known) byHex.set(entry.hex, { ...entry });
    else known.coverage += entry.coverage;
  }
  return [...byHex.values()];
}

/** Pairs of similar colors, most alike first; each color is in at most one pair. */
export function similarPairs(
  entries: PaletteEntry[],
  maxDelta = SIMILAR_DELTA_E,
): MergeSuggestion[] {
  const colors = distinct(entries);
  const pairs: MergeSuggestion[] = [];
  for (let i = 0; i < colors.length; i += 1) {
    for (let j = i + 1; j < colors.length; j += 1) {
      const delta = deltaE2000(colors[i].hex, colors[j].hex);
      if (delta >= maxDelta) continue;
      const [keep, merge] =
        colors[i].coverage >= colors[j].coverage ? [colors[i], colors[j]] : [colors[j], colors[i]];
      pairs.push({ keep, merge, delta });
    }
  }
  pairs.sort((a, b) => a.delta - b.delta);
  const used = new Set<string>();
  return pairs
    .filter((pair) => {
      if (used.has(pair.keep.hex) || used.has(pair.merge.hex)) return false;
      used.add(pair.keep.hex);
      used.add(pair.merge.hex);
      return true;
    })
    .slice(0, MAX_SUGGESTIONS);
}

/** Colors covering less than `minCoverage`, each with the nearest other color to merge into. */
export function tinyColors(
  entries: PaletteEntry[],
  minCoverage = TINY_COVERAGE,
): MergeSuggestion[] {
  const colors = distinct(entries);
  if (colors.length < 2) return [];
  return colors
    .filter((color) => color.coverage < minCoverage)
    .map((merge) => {
      const others = colors.filter((other) => other.hex !== merge.hex);
      const keep = others.reduce((best, other) =>
        deltaE2000(merge.hex, other.hex) < deltaE2000(merge.hex, best.hex) ? other : best,
      );
      return { keep, merge, delta: deltaE2000(merge.hex, keep.hex) };
    })
    .slice(0, MAX_SUGGESTIONS);
}

/** The nearest filament for every entry (CIEDE2000), or an empty map without filaments. */
export function nearestFilaments(
  entries: PaletteEntry[],
  filaments: LibraryFilament[],
): Map<number, { filament: LibraryFilament; delta: number }> {
  const result = new Map<number, { filament: LibraryFilament; delta: number }>();
  if (!filaments.length) return result;
  for (const entry of entries) {
    let best = filaments[0];
    let bestDelta = deltaE2000(entry.hex, best.color);
    for (const filament of filaments.slice(1)) {
      const delta = deltaE2000(entry.hex, filament.color);
      if (delta < bestDelta) {
        best = filament;
        bestDelta = delta;
      }
    }
    result.set(entry.index, { filament: best, delta: bestDelta });
  }
  return result;
}

/** Overrides that recolor every entry of `merge`'s color to `keep`'s color. */
export function mergeOverrides(
  entries: PaletteEntry[],
  suggestion: MergeSuggestion,
): Record<number, string> {
  return Object.fromEntries(
    entries
      .filter((entry) => entry.hex === suggestion.merge.hex)
      .map((entry) => [entry.index, suggestion.keep.hex]),
  );
}
