/**
 * What the print step tells about the model before it is downloaded, from the backend:
 * its size, the filament changes, and per color the filament it takes and its slot.
 */

import type { ColorChanges, ModelSize } from '../types/api';
import type { Printer } from './printers';
import { useColorChanges, useModelSize } from './useBackendResult';

type Options = Record<string, string | number | boolean>;

export interface FilamentUse {
  /** Solid filament per color (grams). */
  grams: Map<string, number>;
  /** Filament slot per color: the 3MF numbers its filaments in this order, base plate first. */
  slots: Map<string, number>;
  /** Solid filament of the whole model (grams); undefined while unknown. */
  totalGrams: number | undefined;
}

export interface PrintStats extends FilamentUse {
  /** Size of the model as exported (border, round plate and loop included). */
  size: ModelSize | null;
  changes: ColorChanges | null;
}

/** Grams and slot of every color from the color changes; empty while they are unknown. */
export function filamentUse(changes: ColorChanges | null): FilamentUse {
  const filaments = changes?.filaments ?? [];
  return {
    grams: new Map(filaments.map((use) => [use.color, use.grams])),
    slots: new Map(filaments.map((use, index) => [use.color, index + 1])),
    totalGrams: changes ? filaments.reduce((sum, use) => sum + use.grams, 0) : undefined,
  };
}

/** The print stats of an SVG and its export options; nothing is asked while disabled. */
export function usePrintStats(
  svg: string,
  options: Options,
  printer: Printer,
  enabled: boolean,
): PrintStats {
  const size = useModelSize(svg, options, enabled);
  const changes = useColorChanges(
    svg,
    { ...options, change_s: printer.changeS, purge_mm3: printer.purgeMm3 },
    // Asked for every printer: it also gives the filament each color takes.
    enabled,
  );
  return { size, changes, ...filamentUse(changes) };
}
