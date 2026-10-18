/**
 * Printer settings remembered in the browser: the nozzle, the printer tuning and the
 * loaded filaments belong to the printer, not to one design, so every new design starts
 * with them. See docs/07-frontend.md.
 */

import { isHexColor } from './color';
import type { Filament } from './mixing';
import { DEFAULT_PRINT, MAX_FILAMENTS, type PrintSettings } from './printPlan';
import { PRINTERS } from './printers';

export const PRINTER_KEY = 'vectorsnap.printer';

export type PrinterSettings = Pick<
  PrintSettings,
  | 'printer'
  | 'filamentSlots'
  | 'nozzleMm'
  | 'elephantFootMm'
  | 'simplifyMm'
  | 'colorGapMm'
  | 'filaments'
>;

/** Allowed range (mm) per remembered number, as in the print step's fields. */
const RANGES = {
  nozzleMm: [0, 10],
  elephantFootMm: [0, 0.5],
  simplifyMm: [0, 2],
  colorGapMm: [0, 2],
} as const;

export type PrinterTuning = Pick<PrinterSettings, keyof typeof RANGES>;

/** Nozzle and tuning as a new printer starts; the reset link restores these. */
export const DEFAULT_TUNING: PrinterTuning = {
  nozzleMm: DEFAULT_PRINT.nozzleMm,
  elephantFootMm: DEFAULT_PRINT.elephantFootMm,
  simplifyMm: DEFAULT_PRINT.simplifyMm,
  colorGapMm: DEFAULT_PRINT.colorGapMm,
};

const TUNING_KEYS = Object.keys(RANGES) as (keyof PrinterTuning)[];

/** Print settings that are remembered for the next designs. */
export const PRINTER_FIELDS: readonly string[] = [
  'printer',
  'filamentSlots',
  ...TUNING_KEYS,
  'filaments',
];

/** Most filaments loaded at once on any supported printer (Kobra X with four ACE 2 Pro). */
const MAX_SLOTS = 19;

export const DEFAULT_PRINTER: PrinterSettings = {
  printer: DEFAULT_PRINT.printer,
  filamentSlots: DEFAULT_PRINT.filamentSlots,
  ...DEFAULT_TUNING,
  filaments: [],
};

/** The printer part of the print settings. */
export function printerOf(settings: PrintSettings): PrinterSettings {
  return {
    printer: settings.printer,
    filamentSlots: settings.filamentSlots,
    nozzleMm: settings.nozzleMm,
    elephantFootMm: settings.elephantFootMm,
    simplifyMm: settings.simplifyMm,
    colorGapMm: settings.colorGapMm,
    filaments: settings.filaments,
  };
}

/** How many of the nozzle and tuning settings differ from the defaults. */
export function tuningChanged(settings: PrintSettings): number {
  return TUNING_KEYS.filter((key) => settings[key] !== DEFAULT_TUNING[key]).length;
}

function isFilament(item: unknown): item is Filament {
  const filament = item as Partial<Filament> | null;
  return (
    typeof filament?.color === 'string' &&
    isHexColor(filament.color) &&
    typeof filament.td === 'number' &&
    filament.td > 0 &&
    filament.td <= 100
  );
}

/** The remembered printer; missing or invalid values read as the defaults. */
export function readPrinter(storage: Pick<Storage, 'getItem'> | undefined): PrinterSettings {
  try {
    const raw = storage?.getItem(PRINTER_KEY);
    if (!raw) return DEFAULT_PRINTER;
    const data = JSON.parse(raw) as Record<string, unknown>;
    const profile = { ...DEFAULT_PRINTER };
    for (const key of TUNING_KEYS) {
      const [min, max] = RANGES[key];
      const value = data[key];
      if (typeof value === 'number' && value >= min && value <= max) profile[key] = value;
    }
    const printer = PRINTERS.find((item) => item.id === data.printer);
    if (printer) profile.printer = printer.id;
    const slots = data.filamentSlots;
    if (typeof slots === 'number' && Number.isInteger(slots) && slots >= 1 && slots <= MAX_SLOTS) {
      profile.filamentSlots = slots;
    }
    if (Array.isArray(data.filaments)) {
      profile.filaments = data.filaments
        .filter(isFilament)
        .slice(0, MAX_FILAMENTS)
        .map((filament) => ({ color: filament.color.toLowerCase(), td: filament.td }));
    }
    return profile;
  } catch {
    return DEFAULT_PRINTER;
  }
}

export function savePrinter(
  storage: Pick<Storage, 'setItem'> | undefined,
  printer: PrinterSettings,
): void {
  try {
    storage?.setItem(PRINTER_KEY, JSON.stringify(printer));
  } catch {
    // Not remembered; the settings still apply to this page.
  }
}
