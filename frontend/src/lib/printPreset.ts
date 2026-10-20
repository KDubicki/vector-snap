/**
 * Print settings as a file: save the settings of one print (project, printer, sizes, base
 * plate, tuning, filaments) and load them for another design. Per-design choices — color
 * heights, raised elements, left-out colors — are not part of it, since palette indices
 * and shape ids belong to one SVG. See docs/07-frontend.md.
 */

import { isHexColor } from './color';
import { DEFAULT_PRINT, MAX_FILAMENTS, PROJECTS, type PrintSettings } from './printPlan';
import { PRINTERS } from './printers';

export const PRESET_KIND = 'vectorsnap-print-settings';
export const PRESET_VERSION = 1;

/** Settings that belong to one design and stay out of a preset. */
const DESIGN_KEYS = ['colorRaise', 'excluded', 'shapeRaise'] as const;
type DesignKey = (typeof DESIGN_KEYS)[number];
export type PrintPreset = Omit<PrintSettings, DesignKey>;

const CHOICES: Partial<Record<keyof PrintPreset, readonly string[]>> = {
  project: PROJECTS.map((project) => project.id),
  printer: PRINTERS.map((printer) => printer.id),
  style: ['flat', 'stepped', 'mixed', 'cutout'],
  baseShape: ['outline', 'rectangle', 'rounded', 'circle'],
  loopPosition: ['top', 'right', 'bottom', 'left'],
};

export function presetJson(settings: PrintSettings): string {
  const preset: Record<string, unknown> = { ...settings };
  for (const key of DESIGN_KEYS) delete preset[key];
  return JSON.stringify({ kind: PRESET_KIND, version: PRESET_VERSION, settings: preset }, null, 2);
}

function validFilaments(value: unknown): value is PrintSettings['filaments'] {
  return (
    Array.isArray(value) &&
    value.length <= MAX_FILAMENTS &&
    value.every(
      (item: { color?: unknown; td?: unknown } | null) =>
        typeof item?.color === 'string' &&
        isHexColor(item.color) &&
        typeof item.td === 'number' &&
        item.td > 0 &&
        item.td <= 100,
    )
  );
}

function validValue(key: keyof PrintPreset, value: unknown): boolean {
  const choices = CHOICES[key];
  if (choices) return typeof value === 'string' && choices.includes(value);
  if (key === 'filaments') return validFilaments(value);
  const expected = typeof DEFAULT_PRINT[key];
  if (expected === 'number') return typeof value === 'number' && Number.isFinite(value);
  return typeof value === expected;
}

/**
 * The settings of a preset file. Fields it leaves out keep their current value; a file
 * that is not a preset, or has a field of the wrong kind, is rejected with a message.
 */
export function readPreset(text: string): Partial<PrintSettings> {
  let data: { kind?: unknown; version?: unknown; settings?: unknown };
  try {
    data = JSON.parse(text) as typeof data;
  } catch {
    throw new Error('Not a print settings file (not JSON).');
  }
  if (data?.kind !== PRESET_KIND || typeof data.settings !== 'object' || !data.settings) {
    throw new Error('Not a VectorSnap print settings file.');
  }
  if (typeof data.version !== 'number' || data.version > PRESET_VERSION) {
    throw new Error('This print settings file is from a newer VectorSnap.');
  }
  const settings = data.settings as Record<string, unknown>;
  const change: Record<string, unknown> = {};
  for (const key of Object.keys(DEFAULT_PRINT) as (keyof PrintSettings)[]) {
    if ((DESIGN_KEYS as readonly string[]).includes(key) || !(key in settings)) continue;
    const value = settings[key];
    if (!validValue(key as keyof PrintPreset, value)) {
      throw new Error(`The print settings file has an invalid "${key}".`);
    }
    change[key] =
      key === 'filaments'
        ? (value as PrintSettings['filaments']).map(({ color, td }) => ({
            color: color.toLowerCase(),
            td,
          }))
        : value;
  }
  return change as Partial<PrintSettings>;
}
