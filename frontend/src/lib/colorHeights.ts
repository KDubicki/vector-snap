/**
 * Per-color heights of STL/3MF exports in the export panel: automatic heights and stacking
 * like the backend, the `layer_heights` form value and its validation.
 * See docs/13-export-formats.md.
 */

import { isHexColor, relativeLuminance } from './color';
import type { ExportValues } from './exportFormats';

/** Per-color height settings: `null` height = automatic (from layer height / stacking). */
export interface ColorHeight {
  paletteIndex: number;
  included: boolean;
  height: number | null;
}

/**
 * Round a height to whole printer layers (at least one), mirroring the backend; heights of
 * 0 and a printer layer height of 0 (off) leave the value unchanged.
 */
export function snapToLayers(height: number, printLayer: number): number {
  if (!(printLayer > 0) || !(height > 0)) return height;
  const layers = Math.max(1, Math.floor(height / printLayer + 0.5 + 1e-9));
  return Number((layers * printLayer).toFixed(6));
}

/**
 * Stack position (bottom = 0) of each color for `stack_order`, mirroring the backend:
 * by brightness, equally bright colors keep the document order.
 */
export function stackPositions(fills: string[], order: unknown): number[] {
  if (order !== 'light_to_dark' && order !== 'dark_to_light') return fills.map((_, i) => i);
  const sign = order === 'dark_to_light' ? 1 : -1;
  const ranked = fills
    .map((fill, index) => ({ index, key: sign * (isHexColor(fill) ? relativeLuminance(fill) : 0) }))
    .sort((a, b) => a.key - b.key);
  const positions: number[] = [];
  ranked.forEach(({ index }, position) => (positions[index] = position));
  return positions;
}

/** Automatic height of the layer at `position` (bottom = 0), mirroring the backend rule. */
export function autoLayerHeight(position: number, values: ExportValues): number {
  const layer = Number(values.layer_mm);
  const height = values.layered ? layer * (position + 1) : layer;
  return snapToLayers(height, Number(values.print_layer_mm ?? 0));
}

/** `layer_heights` form value: excluded colors get 0, explicit heights are sent as-is. */
export function layerHeightsJson(colors: ColorHeight[]): string {
  const entries = colors
    .filter((color) => !color.included || color.height !== null)
    .map((color) => [String(color.paletteIndex), color.included ? color.height : 0]);
  return JSON.stringify(Object.fromEntries(entries));
}

/** Whether any color has a height of its own (the model is no longer flat). */
export function hasCustomHeights(colors: ColorHeight[]): boolean {
  return colors.some((color) => color.height !== null);
}

/** Validation message for per-color heights, or `null` when they are valid. */
export function validateColorHeights(colors: ColorHeight[]): string | null {
  if (colors.length && !colors.some((color) => color.included)) {
    return 'Include at least one color.';
  }
  const invalid = colors.some(
    (color) =>
      color.included &&
      color.height !== null &&
      (!Number.isFinite(color.height) || color.height <= 0 || color.height > 100),
  );
  return invalid ? 'Heights must be greater than 0 and at most 100 mm.' : null;
}
