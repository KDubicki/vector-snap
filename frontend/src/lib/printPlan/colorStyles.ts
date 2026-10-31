/**
 * Switching to the mixed-colors and cut-out styles: mixing recipes, suggested filaments
 * and the test card that checks mixed colors before the whole print.
 */

import type { EditorDoc } from '../../editor/model';
import { deltaE, toLab } from '../color';
import { bestRecipe, type Filament, type MixMatch } from '../mixing';
import { heightPlan, printedGroups } from './heights';
import {
  MAX_FILAMENTS,
  MIXED_LAYER_MM,
  MIXED_MIN_COLOR_LAYERS,
  type PrintSettings,
} from './settings';

/**
 * Mixed colors: for every printed color the closest recipe of the loaded filaments at the
 * color's height (empty without filaments).
 */
export function mixPlan(doc: EditorDoc, settings: PrintSettings): Map<number, MixMatch> {
  const plan = new Map<number, MixMatch>();
  if (!settings.filaments.length) return plan;
  const { colors } = heightPlan(doc, settings);
  for (const group of printedGroups(doc, settings)) {
    const colorLayers = colors.get(group.paletteIndex) ?? settings.colorLayers;
    plan.set(
      group.paletteIndex,
      bestRecipe(group.fill, settings.filaments, {
        layerMm: settings.layerMm,
        baseLayers: settings.baseLayers,
        colorLayers,
      }),
    );
  }
  return plan;
}

/**
 * Settings change for switching to mixed colors: thin layers and enough color height to
 * layer filaments, and filaments suggested from the design when none are set yet.
 */
export function mixedChange(doc: EditorDoc, settings: PrintSettings): Partial<PrintSettings> {
  const change: Partial<PrintSettings> = { style: 'mixed' };
  if (settings.layerMm > MIXED_LAYER_MM) change.layerMm = MIXED_LAYER_MM;
  const layerMm = change.layerMm ?? settings.layerMm;
  // Keep the color height in mm when the layers get thinner, but at least the minimum.
  const colorLayers = Math.round((settings.colorLayers * settings.layerMm) / layerMm);
  if (colorLayers !== settings.colorLayers || colorLayers < MIXED_MIN_COLOR_LAYERS) {
    change.colorLayers = Math.max(colorLayers, MIXED_MIN_COLOR_LAYERS);
  }
  const baseLayers = Math.round((settings.baseLayers * settings.layerMm) / layerMm);
  if (baseLayers !== settings.baseLayers) change.baseLayers = baseLayers;
  if (!settings.filaments.length) change.filaments = suggestFilaments(doc);
  return change;
}

/** Cut-out depth (mm) and plate (mm) a switch to the cut-out style starts with, at least. */
export const CUTOUT_DEPTH_MM = 1;
export const CUTOUT_BASE_MM = 3;

/**
 * Settings change for switching to the cut-out style: a plate thick enough to cut into, a
 * 1 mm deep cut, and — when every color is printed — the bottom color (the background)
 * left solid, so only the lettering on it is cut out.
 */
export function cutoutChange(doc: EditorDoc, settings: PrintSettings): Partial<PrintSettings> {
  const change: Partial<PrintSettings> = { style: 'cutout' };
  const layers = (mm: number) => Math.max(1, Math.round(mm / settings.layerMm));
  const depth = layers(CUTOUT_DEPTH_MM);
  const base = Math.max(settings.baseLayers, layers(CUTOUT_BASE_MM), depth + 1);
  if (base !== settings.baseLayers) change.baseLayers = base;
  if (depth !== settings.colorLayers) change.colorLayers = depth;
  const printed = printedGroups(doc, settings);
  if (printed.length > 1 && printed.length === doc.groups.filter((g) => g.shapes.length).length) {
    change.excluded = [...settings.excluded, printed[0].paletteIndex];
  }
  return change;
}

/** Typical transmission distance for a color: the darker, the more opaque. */
export function typicalTd(color: string): number {
  const [lightness] = toLab(color);
  if (lightness < 25) return 0.5;
  if (lightness < 45) return 1;
  return deltaE(color, '#ffffff') < 15 ? 3 : 1.5;
}

/**
 * Starting filaments for mixed colors: white (prints the base and lightens colors), then
 * the most used, clearly different colors of the design.
 */
export function suggestFilaments(doc: EditorDoc, count = MAX_FILAMENTS): Filament[] {
  const colors = ['#ffffff'];
  // Groups are ordered by coverage (largest first) in traced documents.
  for (const group of doc.groups) {
    if (colors.length >= count) break;
    if (group.shapes.length && colors.every((color) => deltaE(color, group.fill) > 15)) {
      colors.push(group.fill);
    }
  }
  return colors.map((color) => ({ color, td: typicalTd(color) }));
}

/** Test card: square patches (mm), in rows of this many. */
export const CARD_PATCH_MM = 10;
export const CARD_GAP_MM = 2;
export const CARD_COLUMNS = 4;

/**
 * A small print with one square patch per mixed color, printed with the same recipes and
 * heights — to compare the real colors of the loaded filaments with the predictions
 * before printing the whole design. Patches follow the order of the colors in the panel,
 * left to right and top to bottom.
 */
export function testCard(
  doc: EditorDoc,
  settings: PrintSettings,
): { doc: EditorDoc; settings: PrintSettings } {
  const groups = printedGroups(doc, settings);
  const columns = Math.min(CARD_COLUMNS, Math.max(groups.length, 1));
  const step = CARD_PATCH_MM + CARD_GAP_MM;
  const rows = Math.ceil(groups.length / columns);
  const card: EditorDoc = {
    width: columns * step - CARD_GAP_MM,
    height: Math.max(rows * step - CARD_GAP_MM, CARD_PATCH_MM),
    groups: groups.map((group, index) => {
      const x = (index % columns) * step;
      const y = Math.floor(index / columns) * step;
      return {
        paletteIndex: group.paletteIndex,
        fill: group.fill,
        shapes: [
          {
            id: `card-${index}`,
            d: `M${x},${y} H${x + CARD_PATCH_MM} V${y + CARD_PATCH_MM} H${x} Z`,
          },
        ],
      };
    }),
  };
  return {
    doc: card,
    settings: {
      ...settings,
      // One document unit is one millimetre.
      widthMm: card.width,
      baseShape: 'rectangle',
      marginMm: CARD_GAP_MM,
      rimMm: 0,
      loopHoleMm: 0,
      magnetMm: 0,
      screwHoles: 0,
      outlineMm: 0,
      shapeRaise: {},
    },
  };
}
