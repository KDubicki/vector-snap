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

export type ExportOption = NumberOption | BooleanOption;

export interface ExportFormat {
  id: string;
  label: string;
  extension: string;
  description: string;
  options: ExportOption[];
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
    ],
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
];

export type ExportValues = Record<string, number | boolean>;

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
