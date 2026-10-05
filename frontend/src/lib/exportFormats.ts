/**
 * Export formats offered in the result step. SVG is produced in the browser; all other
 * formats are converted by the backend (`POST /api/v1/export/{id}`).
 * See docs/13-export-formats.md.
 */

export interface NumberOption {
  type: 'number';
  name: string;
  label: string;
  unit?: string;
  default: number;
  min: number;
  max: number;
  step: number;
}

export interface BooleanOption {
  type: 'boolean';
  name: string;
  label: string;
  default: boolean;
}

export interface ChoiceOption {
  type: 'choice';
  name: string;
  label: string;
  default: string;
  choices: { value: string; label: string }[];
}

export type ExportOption = NumberOption | BooleanOption | ChoiceOption;

export interface ExportFormat {
  id: string;
  label: string;
  extension: string;
  description: string;
  options: ExportOption[];
  /** Offers per-color heights (sent as `layer_heights`). */
  perColorHeights?: boolean;
}

export const EXPORT_FORMATS: ExportFormat[] = [
  {
    id: 'stl',
    label: 'STL',
    extension: 'stl',
    description: '3D model for printing — each color layer is extruded to its own height.',
    options: [
      {
        type: 'number',
        name: 'width_mm',
        label: 'Width',
        unit: 'mm',
        default: 100,
        min: 1,
        max: 10000,
        step: 1,
      },
      {
        type: 'number',
        name: 'base_mm',
        label: 'Base plate',
        unit: 'mm',
        default: 1,
        min: 0,
        max: 100,
        step: 0.2,
      },
      {
        type: 'number',
        name: 'layer_mm',
        label: 'Height per layer',
        unit: 'mm',
        default: 1,
        min: 0.1,
        max: 100,
        step: 0.2,
      },
      {
        type: 'boolean',
        name: 'layered',
        label: 'Stack colors at increasing heights',
        default: true,
      },
      {
        type: 'boolean',
        name: 'mirror',
        label: 'Mirror (stamps, print face down)',
        default: false,
      },
    ],
    perColorHeights: true,
  },
  {
    id: 'dxf',
    label: 'DXF',
    extension: 'dxf',
    description: 'Outlines for laser cutters, plotters and CNC — one layer per color, units in mm.',
    options: [
      {
        type: 'number',
        name: 'width_mm',
        label: 'Width',
        unit: 'mm',
        default: 100,
        min: 1,
        max: 10000,
        step: 1,
      },
      { type: 'boolean', name: 'fill', label: 'Add solid fills (hatch)', default: false },
    ],
  },
  {
    id: 'pdf',
    label: 'PDF',
    extension: 'pdf',
    description: 'Vector PDF with exact curves for print.',
    options: [
      {
        type: 'choice',
        name: 'page',
        label: 'Page',
        default: 'fit',
        choices: [
          { value: 'fit', label: 'Fit to drawing' },
          { value: 'a4', label: 'A4' },
          { value: 'letter', label: 'Letter' },
        ],
      },
      {
        type: 'number',
        name: 'width_mm',
        label: 'Drawing width (fit page)',
        unit: 'mm',
        default: 100,
        min: 1,
        max: 10000,
        step: 1,
      },
      {
        type: 'number',
        name: 'margin_mm',
        label: 'Margin',
        unit: 'mm',
        default: 10,
        min: 0,
        max: 100,
        step: 1,
      },
    ],
  },
];

export type ExportValues = Record<string, number | boolean | string>;

export function defaultValues(format: ExportFormat): ExportValues {
  return Object.fromEntries(format.options.map((option) => [option.name, option.default]));
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

/** Per-color height settings: `null` height = automatic (from layer height / stacking). */
export interface ColorHeight {
  paletteIndex: number;
  included: boolean;
  height: number | null;
}

/** Automatic height of the layer at `position` (bottom = 0), mirroring the backend rule. */
export function autoLayerHeight(position: number, values: ExportValues): number {
  const layer = Number(values.layer_mm);
  return values.layered ? layer * (position + 1) : layer;
}

/** `layer_heights` form value: excluded colors get 0, explicit heights are sent as-is. */
export function layerHeightsJson(colors: ColorHeight[]): string {
  const entries = colors
    .filter((color) => !color.included || color.height !== null)
    .map((color) => [String(color.paletteIndex), color.included ? color.height : 0]);
  return JSON.stringify(Object.fromEntries(entries));
}

/** Validation message for per-color heights, or `null` when they are valid. */
export function validateColorHeights(colors: ColorHeight[]): string | null {
  if (colors.length && !colors.some((color) => color.included)) {
    return 'Include at least one color.';
  }
  const invalid = colors.some(
    (color) =>
      color.included &&
      color.height !== null &&
      (!Number.isFinite(color.height) || color.height <= 0 || color.height > 100),
  );
  return invalid ? 'Heights must be greater than 0 and at most 100 mm.' : null;
}
