/**
 * Export formats offered in the result step. SVG and PNG are produced in the browser; all
 * other formats are converted by the backend (`POST /api/v1/export/{id}`).
 * See docs/13-export-formats.md.
 */

import { isHexColor, relativeLuminance } from './color';

export interface NumberOption {
  type: 'number';
  name: string;
  label: string;
  unit?: string;
  default: number;
  min: number;
  max: number;
  step: number;
  /** Short explanation shown under the field. */
  hint?: string;
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
  /** Short explanation shown under the field. */
  hint?: string;
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
  /** Rendered in the browser instead of converted by the backend. */
  client?: boolean;
}

/** Options shared by the 3D formats (STL, 3MF), mirroring the backend form fields. */
const MODEL_OPTIONS: ExportOption[] = [
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
    type: 'choice',
    name: 'base_shape',
    label: 'Base plate shape',
    default: 'outline',
    choices: [
      { value: 'outline', label: 'Follow the design' },
      { value: 'rectangle', label: 'Rectangle' },
      { value: 'rounded', label: 'Rounded rectangle' },
      { value: 'circle', label: 'Circle' },
    ],
    hint: 'Rectangle, rounded and circle plates fill gaps and transparent areas (signs, coasters, badges).',
  },
  {
    type: 'number',
    name: 'base_margin_mm',
    label: 'Base plate margin',
    unit: 'mm',
    default: 0,
    min: 0,
    max: 100,
    step: 1,
    hint: 'How far the base plate extends beyond the design — a border around it.',
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
    type: 'choice',
    name: 'stack_order',
    label: 'Color order (bottom to top)',
    default: 'document',
    choices: [
      { value: 'document', label: 'As in the design' },
      { value: 'light_to_dark', label: 'Light to dark' },
      { value: 'dark_to_light', label: 'Dark to light' },
    ],
    hint: 'Which colors are stacked higher; the bottom color also prints the base plate.',
  },
  {
    type: 'number',
    name: 'min_feature_mm',
    label: 'Remove details thinner than',
    unit: 'mm',
    default: 0,
    min: 0,
    max: 10,
    step: 0.1,
    hint: 'Set to the nozzle width (e.g. 0.4) to drop lines and specks too thin to print. 0 keeps everything.',
  },
  {
    type: 'number',
    name: 'print_layer_mm',
    label: 'Printer layer height',
    unit: 'mm',
    default: 0,
    min: 0,
    max: 1,
    step: 0.04,
    hint: 'Rounds the base and every color to whole layers (e.g. 0.2), so colors change exactly at a layer. 0 keeps exact heights.',
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
];

export const EXPORT_FORMATS: ExportFormat[] = [
  {
    id: 'stl',
    label: 'STL',
    extension: 'stl',
    description: '3D model for printing — each color layer is extruded to its own height.',
    options: MODEL_OPTIONS,
    perColorHeights: true,
  },
  {
    id: '3mf',
    label: '3MF',
    extension: '3mf',
    description:
      'Multi-color 3D model — one colored part per color in one model, ready for AMS/MMU printers.',
    options: MODEL_OPTIONS,
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
  {
    id: 'png',
    label: 'PNG',
    extension: 'png',
    description: 'Raster image of the edited document, rendered in your browser.',
    client: true,
    options: [
      {
        type: 'number',
        name: 'width_px',
        label: 'Width',
        unit: 'px',
        default: 2048,
        min: 16,
        max: 16384,
        step: 1,
      },
      {
        type: 'choice',
        name: 'background',
        label: 'Background',
        default: 'transparent',
        choices: [
          { value: 'transparent', label: 'Transparent' },
          { value: 'white', label: 'White' },
        ],
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

/**
 * Round a height to whole printer layers (at least one), mirroring the backend; heights of
 * 0 and a printer layer height of 0 (off) leave the value unchanged.
 */
export function snapToLayers(height: number, printLayer: number): number {
  if (!(printLayer > 0) || !(height > 0)) return height;
  const layers = Math.max(1, Math.floor(height / printLayer + 0.5 + 1e-9));
  return Number((layers * printLayer).toFixed(6));
}

/**
 * Stack position (bottom = 0) of each color for `stack_order`, mirroring the backend:
 * by brightness, equally bright colors keep the document order.
 */
export function stackPositions(fills: string[], order: unknown): number[] {
  if (order !== 'light_to_dark' && order !== 'dark_to_light') return fills.map((_, i) => i);
  const sign = order === 'dark_to_light' ? 1 : -1;
  const ranked = fills
    .map((fill, index) => ({ index, key: sign * (isHexColor(fill) ? relativeLuminance(fill) : 0) }))
    .sort((a, b) => a.key - b.key);
  const positions: number[] = [];
  ranked.forEach(({ index }, position) => (positions[index] = position));
  return positions;
}

/** Automatic height of the layer at `position` (bottom = 0), mirroring the backend rule. */
export function autoLayerHeight(position: number, values: ExportValues): number {
  const layer = Number(values.layer_mm);
  const height = values.layered ? layer * (position + 1) : layer;
  return snapToLayers(height, Number(values.print_layer_mm ?? 0));
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
