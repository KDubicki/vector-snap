/**
 * 3D print step: turns the edited SVG into STL/3MF export options for common projects
 * (fridge magnets, keychains, ornaments, signs). Heights are chosen in printer layers,
 * so every color starts and ends exactly on a layer. See docs/07-frontend.md.
 */

import type { EditorDoc } from '../editor/model';
import { isHexColor } from './color';
import { MAGNET_ROOF_MM } from './exportFormats';
import { bestRecipe, colorStacks, deltaE, toLab, type Filament, type MixMatch } from './mixing';

export type BaseShape = 'outline' | 'rectangle' | 'rounded' | 'circle';

/**
 * flat: every color has the same height, so the top is level — multi-color printers
 * (AMS/MMU) change color within the same layers.
 * stepped: each color one step higher than the one below — single extruder with
 * filament changes at the steps.
 * mixed: flat, but every color is mixed from a few loaded filaments by layering thin
 * translucent layers (see lib/mixing.ts) — more colors than AMS slots.
 */
export type PrintStyle = 'flat' | 'stepped' | 'mixed';

/** Filament slots for mixed colors (one AMS). */
export const MAX_FILAMENTS = 4;
/** Thin layers mix finer; switching to mixed colors uses at most this layer height. */
export const MIXED_LAYER_MM = 0.08;
/**
 * Mixed colors need room for a base and thin layers on top; over the white base plate a
 * thinner color also looks washed out (1.2 mm at 0.08 mm layers).
 */
export const MIXED_MIN_COLOR_LAYERS = 15;

export type ProjectId = 'magnet' | 'keychain' | 'ornament' | 'sign' | 'custom';

export interface PrintSettings {
  project: ProjectId;
  style: PrintStyle;
  /** Printer layer height (mm); every height below is a whole number of these. */
  layerMm: number;
  widthMm: number;
  baseLayers: number;
  /** Height of the colors (flat) or of each step (stepped), in layers. */
  colorLayers: number;
  baseShape: BaseShape;
  marginMm: number;
  /** Hanging loop hole diameter (mm); 0 = no loop. */
  loopHoleMm: number;
  /** Magnet pocket diameter (mm); 0 = none. */
  magnetMm: number;
  magnetDepthMm: number;
  /** Details thinner than this are dropped (mm): the nozzle width. */
  nozzleMm: number;
  /** Extra layers per palette index, on top of the color height. */
  colorRaise: Record<number, number>;
  /** Palette indices left out of the model. */
  excluded: number[];
  /** Extra layers per shape id, on top of its color's height (raised elements). */
  shapeRaise: Record<string, number>;
  /** Loaded filaments for mixed colors; the first one prints the base plate. */
  filaments: Filament[];
}

/** Settings that belong to the design or the printer, so projects keep them. */
export const KEPT_BY_PROJECTS = [
  'style',
  'colorRaise',
  'excluded',
  'shapeRaise',
  'filaments',
] as const;

/** Settings a project applies. */
type ProjectSettings = Omit<PrintSettings, 'project' | (typeof KEPT_BY_PROJECTS)[number]>;

const COMMON: ProjectSettings = {
  layerMm: 0.2,
  widthMm: 80,
  baseLayers: 8,
  colorLayers: 2,
  baseShape: 'outline',
  marginMm: 0,
  loopHoleMm: 0,
  magnetMm: 0,
  magnetDepthMm: 2,
  nozzleMm: 0.4,
};

export interface Project {
  id: ProjectId;
  label: string;
  description: string;
  settings: ProjectSettings;
}

export const PROJECTS: Project[] = [
  {
    id: 'magnet',
    label: 'Fridge magnet',
    description: '60 mm, 2.4 mm base with a pocket for a 10 × 2 mm magnet.',
    settings: { ...COMMON, widthMm: 60, baseLayers: 12, marginMm: 2, magnetMm: 10.2 },
  },
  {
    id: 'keychain',
    label: 'Keychain',
    description: '45 mm, 2 mm base, border and a loop for the key ring.',
    settings: { ...COMMON, widthMm: 45, baseLayers: 10, marginMm: 2, loopHoleMm: 4 },
  },
  {
    id: 'ornament',
    label: 'Christmas ornament',
    description: 'Flat 80 mm bauble on a round plate with a hanging loop.',
    settings: { ...COMMON, baseShape: 'circle', marginMm: 2, loopHoleMm: 3 },
  },
  {
    id: 'sign',
    label: 'Sign or coaster',
    description: '100 mm on a rounded rectangle with a 5 mm border.',
    settings: { ...COMMON, widthMm: 100, baseLayers: 10, baseShape: 'rounded', marginMm: 5 },
  },
  {
    id: 'custom',
    label: 'Custom',
    description: 'Keeps the current settings: set everything yourself.',
    settings: COMMON,
  },
];

export const DEFAULT_PRINT: PrintSettings = {
  project: 'custom',
  style: 'flat',
  ...COMMON,
  colorRaise: {},
  excluded: [],
  shapeRaise: {},
  filaments: [],
};

/** Apply a project's settings; colors, style and filaments stay. Custom changes nothing. */
export function applyProject(settings: PrintSettings, id: ProjectId): PrintSettings {
  const project = PROJECTS.find((item) => item.id === id);
  if (!project || id === 'custom') return { ...settings, project: 'custom' };
  return { ...settings, ...project.settings, project: id };
}

/** Layers to millimetres, without float noise (3 × 0.2 = 0.6, not 0.6000000000000001). */
export function layersToMm(layers: number, layerMm: number): number {
  return Number((layers * layerMm).toFixed(4));
}

/** Groups that print (have shapes and are not left out), bottom to top. */
export function printedGroups(doc: EditorDoc, settings: PrintSettings) {
  return doc.groups.filter(
    (group) => group.shapes.length > 0 && !settings.excluded.includes(group.paletteIndex),
  );
}

/** Height of a color above the base, in layers. */
export function colorLayers(settings: PrintSettings, position: number, paletteIndex: number) {
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
  const tops = [...colors.values(), ...shapes.values(), 0];
  return { colors, shapes, totalLayers: settings.baseLayers + Math.max(...tops) };
}

/** Problems that would make the export fail, by settings field. */
export function validatePrint(doc: EditorDoc, settings: PrintSettings): Record<string, string> {
  const errors: Record<string, string> = {};
  const base = layersToMm(settings.baseLayers, settings.layerMm);
  if (settings.style === 'mixed') {
    const bad = settings.filaments.some(
      (filament) => !isHexColor(filament.color) || !(filament.td > 0 && filament.td <= 100),
    );
    if (!settings.filaments.length) errors.filaments = 'Add at least one filament.';
    else if (bad) errors.filaments = 'Every filament needs a color and a TD above 0 mm.';
  }
  if (!(settings.widthMm >= 1 && settings.widthMm <= 1000)) {
    errors.widthMm = 'Must be between 1 and 1000 mm.';
  }
  if (!(settings.colorLayers >= 1)) errors.colorLayers = 'At least 1 layer.';
  if (!(settings.baseLayers >= 0)) errors.baseLayers = 'Cannot be negative.';
  if (settings.loopHoleMm > 0 && base <= 0) errors.loopHoleMm = 'A hanging loop needs a base.';
  if (settings.magnetMm > 0 && settings.magnetDepthMm > base - MAGNET_ROOF_MM + 1e-9) {
    const layers = Math.ceil((settings.magnetDepthMm + MAGNET_ROOF_MM) / settings.layerMm - 1e-9);
    errors.magnetDepthMm = `Needs a base of at least ${layers} layers (${layersToMm(layers, settings.layerMm)} mm).`;
  }
  if (printedGroups(doc, settings).length === 0) errors.colors = 'Include at least one color.';
  return errors;
}

/** STL/3MF form options for the backend (docs/13-export-formats.md). */
export function printOptions(
  doc: EditorDoc,
  settings: PrintSettings,
): Record<string, string | number | boolean> {
  const { colors, shapes } = heightPlan(doc, settings);
  const mm = (layers: number) => layersToMm(layers, settings.layerMm);
  const layerHeights: Record<string, number> = {};
  for (const group of doc.groups) {
    layerHeights[group.paletteIndex] = mm(colors.get(group.paletteIndex) ?? 0);
  }
  const shapeHeights = Object.fromEntries([...shapes].map(([id, layers]) => [id, mm(layers)]));
  const mixed: Record<string, string> =
    settings.style === 'mixed'
      ? {
          filaments: JSON.stringify(settings.filaments.map((filament) => filament.color)),
          color_stacks: JSON.stringify(
            colorStacks(
              new Map([...mixPlan(doc, settings)].map(([index, match]) => [index, match.recipe])),
              settings.layerMm,
            ),
          ),
        }
      : {};
  return {
    width_mm: settings.widthMm,
    base_mm: mm(settings.baseLayers),
    layer_mm: mm(settings.colorLayers),
    layered: settings.style === 'stepped',
    layer_heights: JSON.stringify(layerHeights),
    shape_heights: JSON.stringify(shapeHeights),
    print_layer_mm: settings.layerMm,
    min_feature_mm: settings.nozzleMm,
    base_shape: settings.baseShape,
    base_margin_mm: settings.marginMm,
    stack_order: 'document',
    loop_hole_mm: settings.loopHoleMm,
    magnet_mm: settings.magnetMm,
    magnet_depth_mm: settings.magnetDepthMm,
    mirror: false,
    ...mixed,
  };
}

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
