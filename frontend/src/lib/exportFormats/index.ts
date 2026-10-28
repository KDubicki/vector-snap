/**
 * Export formats offered in the result step. SVG and PNG are produced in the browser; all
 * other formats are converted by the backend (`POST /api/v1/export/{id}`).
 * See docs/13-export-formats.md.
 */

import { CRAFT_FORMATS } from './crafts';
import { DRAWING_FORMATS } from './drawings';
import { MODEL_FORMATS } from './models';
import type { ExportFormat, ExportOption, ExportValues } from './types';

export type * from './types';
export { MAGNET_ROOF_MM } from './modelOptions';

/** In the order the export panel offers them. */
export const EXPORT_FORMATS: ExportFormat[] = [
  ...MODEL_FORMATS,
  ...CRAFT_FORMATS,
  ...DRAWING_FORMATS,
];

/** Extension of the downloaded file with these option values. */
export function formatExtension(format: ExportFormat, values: ExportValues): string {
  return format.extensionFor?.(values) ?? format.extension;
}

export function defaultValues(format: ExportFormat): ExportValues {
  return Object.fromEntries(format.options.map((option) => [option.name, option.default]));
}

export interface OptionSection {
  /** `null` for the options that are always shown. */
  name: string | null;
  options: ExportOption[];
}

/** Options grouped by section: the unsectioned ones first, then sections in order. */
export function optionSections(format: ExportFormat): OptionSection[] {
  const sections: OptionSection[] = [{ name: null, options: [] }];
  for (const option of format.options) {
    const name = option.section ?? null;
    let section = sections.find((item) => item.name === name);
    if (!section) {
      section = { name, options: [] };
      sections.push(section);
    }
    section.options.push(option);
  }
  return sections.filter((section) => section.options.length > 0);
}

/** How many of `options` differ from their defaults (shown on collapsed sections). */
export function changedCount(options: ExportOption[], values: ExportValues): number {
  return options.filter((option) => values[option.name] !== option.default).length;
}

/** Validate option values; returns an error message per invalid option name. */
export function validate(format: ExportFormat, values: ExportValues): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const option of format.options) {
    const value = values[option.name];
    if (option.type === 'number') {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        errors[option.name] = 'Enter a number.';
      } else if (value < option.min || value > option.max) {
        errors[option.name] = `Must be between ${option.min} and ${option.max}.`;
      } else {
        const message = option.check?.(value, values);
        if (message) errors[option.name] = message;
      }
    } else if (option.type === 'choice') {
      if (!option.choices.some((choice) => choice.value === value)) {
        errors[option.name] = 'Choose one of the options.';
      }
    } else if (typeof value !== 'boolean') {
      errors[option.name] = 'Invalid value.';
    }
  }
  return errors;
}

/** File name for an export, based on the uploaded file name. */
export function exportFileName(sourceName: string | undefined, extension: string): string {
  const base = sourceName?.replace(/\.[^.]+$/, '') || 'vectorsnap';
  return `${base}.${extension}`;
}

/** Longest 3MF title the backend takes. */
const MAX_TITLE = 200;

/**
 * The 3MF `title` for an image: its name without the extension, which slicers show as
 * the object's name. Empty without a file (the backend then names it VectorSnap).
 */
export function modelTitle(sourceName: string | undefined): string {
  return (sourceName?.replace(/\.[^.]+$/, '') ?? '').trim().slice(0, MAX_TITLE);
}
