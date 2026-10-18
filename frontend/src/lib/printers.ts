/**
 * Printer models for the 3D print step: build volume, nozzles with the layer heights the
 * slicer offers for them, filament slots and the cost of a filament change. Values of the
 * Anycubic Kobra X come from the Anycubic Slicer Next 2.0 profiles. See docs/07-frontend.md.
 */

import type { ModelSize } from '../types/api';
import type { PrintSettings } from './printPlan';

/** Wall around the hanging loop hole (backend `LOOP_WALL_MM`). */
const LOOP_WALL_MM = 2;

export type PrinterId = 'any' | 'kobra-x';

export interface Nozzle {
  mm: number;
  /** Layer heights of the slicer's process profiles for this nozzle; the first is the default. */
  layers: number[];
  minLayerMm: number;
  maxLayerMm: number;
}

export interface Printer {
  id: PrinterId;
  label: string;
  /** Build volume (mm): x, y, z; null = not checked. */
  buildMm: [number, number, number] | null;
  /** Nozzles to choose from; empty = any nozzle width. */
  nozzles: Nozzle[];
  /** Filaments loaded at once without extensions, and with all of them (null = unknown). */
  slots: number | null;
  maxSlots: number | null;
  /** One filament change: time and purged filament (flush + prime tower). */
  changeS: number;
  purgeMm3: number;
}

/** Layer heights of the generic printer (0.4 mm nozzle). */
export const ANY_LAYERS = [0.08, 0.12, 0.16, 0.2, 0.24, 0.28];

export const PRINTERS: Printer[] = [
  {
    id: 'any',
    label: 'Any printer',
    buildMm: null,
    nozzles: [],
    slots: null,
    maxSlots: null,
    changeS: 0,
    purgeMm3: 0,
  },
  {
    id: 'kobra-x',
    label: 'Anycubic Kobra X',
    buildMm: [260, 260, 260],
    nozzles: [
      { mm: 0.25, layers: [0.1, 0.06, 0.08, 0.12, 0.14], minLayerMm: 0.05, maxLayerMm: 0.18 },
      {
        mm: 0.4,
        layers: [0.2, 0.08, 0.12, 0.16, 0.24, 0.28],
        minLayerMm: 0.08,
        maxLayerMm: 0.28,
      },
      { mm: 0.6, layers: [0.3, 0.18, 0.24, 0.36, 0.42], minLayerMm: 0.12, maxLayerMm: 0.42 },
      { mm: 0.8, layers: [0.4, 0.24, 0.32, 0.48, 0.56], minLayerMm: 0.16, maxLayerMm: 0.56 },
    ],
    // ACE Gen 2 in the toolhead; up to 19 with four ACE 2 Pro.
    slots: 4,
    maxSlots: 19,
    // Anycubic Slicer Next's estimate per change, prime tower included; 280 mm³ flush × 0.7
    // + 30 mm³ prime volume.
    changeS: 53,
    purgeMm3: 226,
  },
];

export function printerById(id: PrinterId): Printer {
  return PRINTERS.find((printer) => printer.id === id) ?? PRINTERS[0];
}

export function nozzleOf(printer: Printer, nozzleMm: number): Nozzle | null {
  return printer.nozzles.find((nozzle) => nozzle.mm === nozzleMm) ?? null;
}

/** Layer heights to offer, sorted. */
export function layerChoices(printer: Printer, nozzleMm: number): number[] {
  const nozzle = nozzleOf(printer, nozzleMm);
  return nozzle ? [...nozzle.layers].sort((a, b) => a - b) : ANY_LAYERS;
}

/**
 * Settings change that makes the settings printable on the printer: a nozzle it has and a
 * layer height the nozzle prints. Heights stay the same in mm (whole layers).
 */
export function fitToPrinter(settings: PrintSettings, printer: Printer): Partial<PrintSettings> {
  const change: Partial<PrintSettings> = {};
  if (printer.maxSlots && settings.filamentSlots > printer.maxSlots) {
    change.filamentSlots = printer.maxSlots;
  }
  if (!printer.nozzles.length) return change;
  const nozzle =
    nozzleOf(printer, settings.nozzleMm) ??
    printer.nozzles.find((item) => item.mm === 0.4) ??
    printer.nozzles[0];
  if (nozzle.mm !== settings.nozzleMm) change.nozzleMm = nozzle.mm;
  if (settings.layerMm < nozzle.minLayerMm || settings.layerMm > nozzle.maxLayerMm) {
    Object.assign(change, withLayerHeight(settings, nozzle.layers[0]));
  }
  return change;
}

/** A new printer layer height, keeping base and color heights in mm (at least 1 layer). */
export function withLayerHeight(settings: PrintSettings, layerMm: number): Partial<PrintSettings> {
  const layers = (count: number, min: number) =>
    Math.max(min, Math.round((count * settings.layerMm) / layerMm));
  return {
    layerMm,
    baseLayers: layers(settings.baseLayers, 0),
    colorLayers: layers(settings.colorLayers, 1),
  };
}

const mm = (value: number) => Number(value.toFixed(1));

/** What exceeds the build volume, e.g. "301.2 mm wide (max 260)"; empty when it fits. */
export function buildProblems(size: ModelSize, printer: Printer): string[] {
  if (!printer.buildMm) return [];
  const [x, y, z] = printer.buildMm;
  return [
    [size.x_mm, x, 'wide'],
    [size.y_mm, y, 'deep'],
    [size.z_mm, z, 'tall'],
  ]
    .filter(([value, max]) => (value as number) > (max as number))
    .map(([value, max, axis]) => `${mm(value as number)} mm ${axis} (max ${max})`);
}

/**
 * The largest whole-mm width whose model fits the bed, or null when the footprint fits
 * already or nothing helps. Border and loop keep their size when the design shrinks.
 */
export function fitWidthMm(
  settings: PrintSettings,
  size: ModelSize,
  printer: Printer,
): number | null {
  if (!printer.buildMm) return null;
  const [maxX, maxY] = printer.buildMm;
  if (size.x_mm <= maxX && size.y_mm <= maxY) return null;
  const border = 2 * settings.marginMm;
  const loop = settings.loopHoleMm > 0 ? settings.loopHoleMm + 2 * LOOP_WALL_MM : 0;
  const scale = (value: number, max: number, fixed: number) =>
    value - fixed > 0 ? (max - fixed) / (value - fixed) : Infinity;
  const ratio = Math.min(scale(size.x_mm, maxX, border), scale(size.y_mm, maxY, border + loop));
  const width = Math.floor(settings.widthMm * ratio);
  return width >= 1 && width < settings.widthMm ? width : null;
}
