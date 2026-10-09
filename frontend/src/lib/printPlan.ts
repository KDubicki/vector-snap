/**
 * 3D print step: turns the edited SVG into STL/3MF export options for common projects
 * (fridge magnets, keychains, ornaments, signs). Heights are chosen in printer layers,
 * so every color starts and ends exactly on a layer. See docs/07-frontend.md.
 */

import type { EditorDoc } from '../editor/model';
import { MAGNET_ROOF_MM } from './exportFormats';

export type BaseShape = 'outline' | 'rectangle' | 'rounded' | 'circle';

/**
 * flat: every color has the same height, so the top is level — multi-color printers
 * (AMS/MMU) change color within the same layers.
 * stepped: each color one step higher than the one below — single extruder with
 * filament changes at the steps.
 */
export type PrintStyle = 'flat' | 'stepped';

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
}

/** Settings a project applies; colors and raised elements are kept. */
type ProjectSettings = Omit<PrintSettings, 'project' | 'colorRaise' | 'excluded' | 'shapeRaise'>;

const COMMON: ProjectSettings = {
  style: 'flat',
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
  ...COMMON,
  colorRaise: {},
  excluded: [],
  shapeRaise: {},
};

/** Apply a project's settings; colors and raised elements stay. Custom changes nothing. */
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
  };
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
