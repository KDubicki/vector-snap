/**
 * 3D print step: turns the edited SVG into STL/3MF export options for common projects
 * (fridge magnets, keychains, ornaments, signs). Heights are chosen in printer layers,
 * so every color starts and ends exactly on a layer. See docs/07-frontend.md.
 */

import type { EditorDoc } from '../editor/model';
import { deltaE, isHexColor, relativeLuminance, toLab } from './color';
import { MAGNET_ROOF_MM } from './exportFormats';
import { bestRecipe, colorStacks, type Filament, type MixMatch } from './mixing';
import { nozzleOf, printerById, type PrinterId } from './printers';

export type BaseShape = 'outline' | 'rectangle' | 'rounded' | 'circle';

/**
 * flat: every color has the same height, so the top is level — multi-color printers
 * (AMS/MMU) change color within the same layers.
 * stepped: each color one step higher than the one below — single extruder with
 * filament changes at the steps.
 * mixed: flat, but every color is mixed from a few loaded filaments by layering thin
 * translucent layers (see lib/mixing.ts) — more colors than AMS slots.
 * cutout: one filament — the printed colors are cut out of the base plate (lettering
 * made of missing filament), to their depth or through it; no filament changes.
 */
export type PrintStyle = 'flat' | 'stepped' | 'mixed' | 'cutout';

/** Filament slots for mixed colors (one AMS). */
export const MAX_FILAMENTS = 4;
/** Thin layers mix finer; switching to mixed colors uses at most this layer height. */
export const MIXED_LAYER_MM = 0.08;
/**
 * Mixed colors need room for a base and thin layers on top; over the white base plate a
 * thinner color also looks washed out (1.2 mm at 0.08 mm layers).
 */
export const MIXED_MIN_COLOR_LAYERS = 15;

export type ProjectId = 'magnet' | 'keychain' | 'ornament' | 'sign' | 'coaster' | 'custom';

export interface PrintSettings {
  project: ProjectId;
  /** Printer model: build volume, nozzles and layer heights (lib/printers.ts). */
  printer: PrinterId;
  /** Filaments loaded at once (AMS/ACE slots) on a printer that has slots. */
  filamentSlots: number;
  style: PrintStyle;
  /** Printer layer height (mm); every height below is a whole number of these. */
  layerMm: number;
  widthMm: number;
  baseLayers: number;
  /** Height of the colors (flat) or of each step (stepped), in layers. */
  colorLayers: number;
  baseShape: BaseShape;
  marginMm: number;
  /** Width of a raised rim along the base plate's edge (mm), as high as the colors; 0 = none. */
  rimMm: number;
  /** Hanging loop hole diameter (mm); 0 = no loop. */
  loopHoleMm: number;
  /** Magnet pocket diameter (mm); 0 = none. */
  magnetMm: number;
  magnetDepthMm: number;
  /** Details thinner than this are dropped (mm): the nozzle width. */
  nozzleMm: number;
  /** Colors sunk into the base plate, flush with its top (a flat surface). */
  inlay: boolean;
  /** Cut-out style: cut the colors through the plate (a stencil) instead of to a depth. */
  cutThrough: boolean;
  /** Mirror the model left to right: stamps print face down and read right on paper. */
  mirror: boolean;
  /** Printer tuning (mm, 0 = off): first layer inset, outline smoothing, gap between colors. */
  elephantFootMm: number;
  simplifyMm: number;
  colorGapMm: number;
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
  'cutThrough',
  'mirror',
  'colorRaise',
  'excluded',
  'shapeRaise',
  'filaments',
  'printer',
  'filamentSlots',
  'nozzleMm',
  'elephantFootMm',
  'simplifyMm',
  'colorGapMm',
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
  rimMm: 0,
  loopHoleMm: 0,
  magnetMm: 0,
  magnetDepthMm: 2,
  inlay: false,
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
    id: 'coaster',
    label: 'Flat coaster',
    description: '100 mm round coaster, colors set flush into a 3 mm base — a flat top for AMS.',
    settings: {
      ...COMMON,
      widthMm: 100,
      baseLayers: 15,
      baseShape: 'circle',
      marginMm: 4,
      inlay: true,
    },
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
  printer: 'any',
  filamentSlots: 4,
  style: 'flat',
  ...COMMON,
  colorRaise: {},
  excluded: [],
  shapeRaise: {},
  filaments: [],
  cutThrough: false,
  mirror: false,
  nozzleMm: 0.4,
  elephantFootMm: 0,
  simplifyMm: 0,
  colorGapMm: 0,
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

/** Filaments the print needs: the loaded ones for mixed colors, else one per color. */
export function filamentsNeeded(doc: EditorDoc, settings: PrintSettings): number {
  if (settings.style === 'cutout') return 1;
  if (settings.style === 'mixed') return settings.filaments.length;
  return new Set(printedGroups(doc, settings).map((group) => group.fill.toLowerCase())).size;
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
  if (settings.rimMm > 0 && base <= 0) errors.rimMm = 'A rim needs a base.';
  if (settings.elephantFootMm > 0 && base <= 0) {
    errors.elephantFootMm = "Elephant's foot compensation needs a base.";
  }
  const cutout = settings.style === 'cutout';
  const sunk = cutout || settings.inlay;
  // Inlaid colors take the top of the base plate: it must be thicker than the tallest.
  const inlaid = sunk ? Math.min(heightPlan(doc, settings).top, settings.baseLayers) : 0;
  if (cutout && settings.baseLayers <= 0) {
    errors.baseLayers = 'Cutting out needs a base plate to cut into.';
  } else if (cutout && heightPlan(doc, settings).top > settings.baseLayers) {
    errors.colorLayers = `Deeper than the base plate (${settings.baseLayers} layers): tick "Cut through" for holes.`;
  }
  const needed = (layers: number) =>
    `Needs a base of at least ${layers} layers (${layersToMm(layers, settings.layerMm)} mm).`;
  if (!cutout && settings.inlay && settings.baseLayers <= inlaid) {
    errors.inlay = needed(inlaid + 1);
  }
  const solid = layersToMm(settings.baseLayers - inlaid, settings.layerMm);
  if (settings.magnetMm > 0 && settings.magnetDepthMm > solid - MAGNET_ROOF_MM + 1e-9) {
    const layers = Math.ceil((settings.magnetDepthMm + MAGNET_ROOF_MM) / settings.layerMm - 1e-9);
    errors.magnetDepthMm = needed(layers + inlaid);
  }
  const printer = printerById(settings.printer);
  const nozzle = nozzleOf(printer, settings.nozzleMm);
  if (nozzle && (settings.layerMm < nozzle.minLayerMm || settings.layerMm > nozzle.maxLayerMm)) {
    errors.layerMm = `The ${printer.label} prints ${nozzle.mm} mm nozzle layers of ${nozzle.minLayerMm}–${nozzle.maxLayerMm} mm.`;
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
    rim_mm: settings.rimMm,
    rim_height_mm: 0,
    loop_hole_mm: settings.loopHoleMm,
    magnet_mm: settings.magnetMm,
    magnet_depth_mm: settings.magnetDepthMm,
    relief: settings.style === 'cutout' ? 'engrave' : settings.inlay ? 'inlay' : 'raised',
    elephant_foot_mm: settings.elephantFootMm,
    simplify_mm: settings.simplifyMm,
    color_gap_mm: settings.colorGapMm,
    mirror: settings.mirror,
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
      shapeRaise: {},
    },
  };
}
