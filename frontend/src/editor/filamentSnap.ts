/**
 * Every color of the editor document replaced by the closest filament at hand
 * (CIEDE2000), so the SVG prints with what is loaded: the editor's *Use my filaments*.
 * Groups that end up with the same filament become one (one filament, one group), and
 * shapes with an own color that snaps to their group's filament follow the group again.
 * See docs/08-svg-editor.md#my-filaments.
 */
import { deltaE2000 } from '../lib/color';
import type { LibraryFilament } from '../lib/filamentLibrary';
import type { EditorDoc } from './model';
import { findSimilarColors, mergeSimilarColors } from './similarColors';

export interface FilamentChange {
  paletteIndex: number;
  fill: string;
  filament: LibraryFilament;
  deltaE: number;
}

/** Identical colors: the merge after snapping joins only groups of one filament. */
const SAME_COLOR = 0.01;

/** The closest filament to `hex`; `filaments` is not empty. */
export function closestFilament(
  hex: string,
  filaments: LibraryFilament[],
): { filament: LibraryFilament; deltaE: number } {
  let best = { filament: filaments[0], deltaE: deltaE2000(hex, filaments[0].color) };
  for (const filament of filaments.slice(1)) {
    const delta = deltaE2000(hex, filament.color);
    if (delta < best.deltaE) best = { filament, deltaE: delta };
  }
  return best;
}

/** What every group's color becomes; groups already in a filament's color are left out. */
export function filamentChanges(doc: EditorDoc, filaments: LibraryFilament[]): FilamentChange[] {
  if (!filaments.length) return [];
  return doc.groups.flatMap((group) => {
    const { filament, deltaE } = closestFilament(group.fill, filaments);
    return filament.color === group.fill.toLowerCase()
      ? []
      : [{ paletteIndex: group.paletteIndex, fill: group.fill, filament, deltaE }];
  });
}

/**
 * The document in the closest filaments, groups of one filament joined; `doc` itself when
 * every color is a filament's already.
 */
export function snapToFilaments(doc: EditorDoc, filaments: LibraryFilament[]): EditorDoc {
  if (!filaments.length) return doc;
  const snapped = new Map<string, string>();
  let changed = false;
  const snap = (hex: string) => {
    const key = hex.toLowerCase();
    if (!snapped.has(key)) snapped.set(key, closestFilament(key, filaments).filament.color);
    const color = snapped.get(key)!;
    changed ||= color !== hex;
    return color;
  };
  const recolored: EditorDoc = {
    ...doc,
    groups: doc.groups.map((group) => ({
      ...group,
      fill: snap(group.fill),
      shapes: group.shapes.map((shape) =>
        shape.fill ? { ...shape, fill: snap(shape.fill) } : shape,
      ),
    })),
  };
  const merged = mergeSimilarColors(recolored, findSimilarColors(recolored, SAME_COLOR));
  return changed || merged !== recolored ? merged : doc;
}
