/**
 * Print settings of the 3D print step: the styles, every option and its units. Heights
 * are counted in printer layers, so every color starts and ends exactly on a layer.
 */

import type { BaseShape } from '../baseShapes';
import type { Filament } from '../mixing';
import type { PrinterId } from '../printers';

export type { BaseShape } from '../baseShapes';

/** Side of the base plate the hanging loop sticks out of. */
export type LoopPosition = 'top' | 'right' | 'bottom' | 'left';

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
  loopPosition: LoopPosition;
  /** Magnet pocket diameter (mm); 0 = none. */
  magnetMm: number;
  magnetDepthMm: number;
  /** Magnet pockets, spread along the plate's longer side. */
  magnetCount: number;
  /** Screw holes through the plate beside the design: 0, 2 or 4. */
  screwHoles: number;
  screwHoleMm: number;
  /** Outlines along every color's edges (mm, 0 = none) in their own filament, flush with
   * the tallest color or one layer above it. Flat and stepped colors only. */
  outlineMm: number;
  outlineColor: string;
  outlineRaised: boolean;
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
  /** Copies printed together on the bed, in a grid `COPY_GAP_MM` apart. */
  copies: number;
}

/** Space between copies on the bed (mm), the backend's `copy_gap_mm` default. */
export const COPY_GAP_MM = 5;
export const MAX_COPIES = 100;

/** Columns and rows of `copies` on the bed, as the backend lays them out. */
export function copyGrid(copies: number): { columns: number; rows: number } {
  const columns = Math.ceil(Math.sqrt(copies));
  return { columns, rows: Math.ceil(copies / columns) };
}

/** Height of the design (mm) at a width, for a design `aspect` (height / width) tall. */
export function designHeightMm(widthMm: number, aspect: number): number {
  return Number((widthMm * aspect).toFixed(1));
}

/** The width (mm) that makes the design `heightMm` tall. */
export function widthForHeight(heightMm: number, aspect: number): number {
  return Number((heightMm / aspect).toFixed(2));
}

/** Layers to millimetres, without float noise (3 × 0.2 = 0.6, not 0.6000000000000001). */
export function layersToMm(layers: number, layerMm: number): number {
  return Number((layers * layerMm).toFixed(4));
}

/** Plastic between a screw hole and the plate's edge or the design (mm), as the backend. */
export const SCREW_WALL_MM = 1.5;

/** The border a screw hole needs beside the design: the hole and a wall on each side. */
export function screwBorderMm(holeMm: number): number {
  return Number((holeMm + 2 * SCREW_WALL_MM).toFixed(1));
}
