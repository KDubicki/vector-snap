/** Which colors print, their heights in layers, and raised colors and shapes. */

import type { EditorDoc } from '../../editor/model';
import { isHexColor, relativeLuminance } from '../color';
import type { LibraryFilament } from '../filamentLibrary';
import { nearestFilaments } from '../paletteAdvice';
import type { PrintSettings } from './settings';

/** Groups that print (have shapes and are not left out), bottom to top. */
export function printedGroups(doc: EditorDoc, settings: PrintSettings) {
  return doc.groups.filter(
    (group) => group.shapes.length > 0 && !settings.excluded.includes(group.paletteIndex),
  );
}

/** Filaments the print needs: the loaded ones for mixed colors, else one per color. */
export function filamentsNeeded(doc: EditorDoc, settings: PrintSettings): number {
  if (settings.style === 'cutout') return 1;
  if (settings.style === 'mixed') return settings.filaments.length;
  const colors = new Set(printedGroups(doc, settings).map((group) => group.fill.toLowerCase()));
  if (outlined(settings)) colors.add(settings.outlineColor.toLowerCase());
  return colors.size;
}

/** Whether the model gets outlines: flat and stepped colors only. */
export function outlined(settings: PrintSettings): boolean {
  return settings.outlineMm > 0 && (settings.style === 'flat' || settings.style === 'stepped');
}

/**
 * The nearest of `filaments` for every color, by palette index, when each color prints in
 * its own filament. Mixed colors have their own recipes and cut-out colors are holes, not
 * filament, so they get none.
 */
export function filamentMatches(
  doc: EditorDoc,
  settings: PrintSettings,
  filaments: LibraryFilament[],
): Map<number, { filament: LibraryFilament; delta: number }> | undefined {
  if (settings.style !== 'flat' && settings.style !== 'stepped') return undefined;
  const entries = doc.groups.map((group) => ({
    index: group.paletteIndex,
    hex: group.fill,
    coverage: 0,
  }));
  return nearestFilaments(entries, filaments);
}

/** Height of a color above the base, in layers. */
export function colorLayers(settings: PrintSettings, position: number, paletteIndex: number) {
  if (settings.style === 'cutout' && settings.cutThrough) return settings.baseLayers;
  const steps = settings.style === 'stepped' ? position + 1 : 1;
  return settings.colorLayers * steps + (settings.colorRaise[paletteIndex] ?? 0);
}

/** Every height of the model, in layers: base, per color and per raised shape. */
export function heightPlan(doc: EditorDoc, settings: PrintSettings) {
  const colors = new Map<number, number>();
  const shapes = new Map<string, number>();
  printedGroups(doc, settings).forEach((group, position) => {
    const layers = colorLayers(settings, position, group.paletteIndex);
    colors.set(group.paletteIndex, layers);
    for (const shape of group.shapes) {
      const raise = settings.shapeRaise[shape.id] ?? 0;
      if (raise !== 0) shapes.set(shape.id, Math.max(0, layers + raise));
    }
  });
  const top = Math.max(...colors.values(), ...shapes.values(), 0);
  // Inlaid colors sink into the base plate instead of standing on it; cut-out ones are
  // only missing from it.
  const totalLayers =
    settings.style === 'cutout'
      ? settings.baseLayers
      : settings.inlay
        ? Math.max(settings.baseLayers, top)
        : settings.baseLayers + top;
  return { colors, shapes, top, totalLayers };
}

/** Which colors an automatic relief puts on top. */
export type ReliefOrder = 'dark' | 'light';

/**
 * Extra layers for an automatic relief: the printed colors ranked by brightness, each
 * `step` layers above the previous one, the lowest at its normal height. With `dark` on
 * top, outlines and text usually stand out; equally bright colors keep the document order.
 */
export function reliefRaise(
  doc: EditorDoc,
  settings: PrintSettings,
  order: ReliefOrder,
  step = 1,
): Record<number, number> {
  const sign = order === 'dark' ? -1 : 1;
  const ranked = printedGroups(doc, settings)
    .map((group, position) => ({
      paletteIndex: group.paletteIndex,
      position,
      key: sign * (isHexColor(group.fill) ? relativeLuminance(group.fill) : 0),
    }))
    .sort((a, b) => a.key - b.key || a.position - b.position);
  return Object.fromEntries(ranked.map((item, rank) => [item.paletteIndex, rank * step]));
}

/** Set the extra layers of some shapes; 0 (or less) removes them. */
export function setShapeRaise(
  current: Record<string, number>,
  ids: string[],
  layers: number,
): Record<string, number> {
  const next = { ...current };
  for (const id of ids) {
    if (layers > 0) next[id] = layers;
    else delete next[id];
  }
  return next;
}

/** Extra layers shared by all `ids` (0 when not raised), or `null` when they differ. */
export function sharedRaise(current: Record<string, number>, ids: string[]): number | null {
  const values = new Set(ids.map((id) => current[id] ?? 0));
  return values.size === 1 ? [...values][0] : null;
}

/** Selection after clicking a shape (`null`: empty space); `additive` toggles. */
export function nextSelection(selected: string[], id: string | null, additive: boolean): string[] {
  if (id === null) return additive ? selected : [];
  if (!additive) return selected.length === 1 && selected[0] === id ? [] : [id];
  return selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id];
}
