/**
 * Colors a 2D craft export (cookie cutter, sticker, stencil, coloring page) leaves out,
 * sent as `exclude_colors`. A background kept from the image would make the outline the
 * rectangle of the whole image, so it is left out until it is chosen. See
 * docs/13-export-formats.md#colors-to-use.
 */
import { pathsBounds } from '../editor/geometry';
import type { EditorDoc } from '../editor/model';

/** Share of the image's width and height a background spans. */
const BACKGROUND_SPAN = 0.98;

/**
 * The color group of a background kept from the image: the first (lowest) one spanning
 * the whole image. With cutout tracing it is not the bottom group but has holes where the
 * design is; its outline still spans the image. Null when no group does, or only one is left.
 */
export function backgroundGroup(doc: EditorDoc): number | null {
  if (doc.groups.length < 2) return null;
  const spanning = doc.groups.find((group) => {
    const bounds = pathsBounds(group.shapes.map((shape) => shape.d));
    return (
      bounds !== null &&
      bounds.width >= doc.width * BACKGROUND_SPAN &&
      bounds.height >= doc.height * BACKGROUND_SPAN
    );
  });
  return spanning?.paletteIndex ?? null;
}

/**
 * Palette indices to leave out: the colors chosen (`null`: none chosen yet, so the
 * background), limited to the colors the design still has.
 */
export function excludedColors(doc: EditorDoc, chosen: readonly number[] | null): number[] {
  if (chosen === null) {
    const background = backgroundGroup(doc);
    return background === null ? [] : [background];
  }
  return doc.groups.map((group) => group.paletteIndex).filter((index) => chosen.includes(index));
}

/** Why the export cannot run with these colors left out, or null. */
export function usedColorsError(doc: EditorDoc, excluded: readonly number[]): string | null {
  return excluded.length >= doc.groups.length ? 'Use at least one color.' : null;
}
