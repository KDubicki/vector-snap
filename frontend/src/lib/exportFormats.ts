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
  /** Extra rule involving other options: an error message, or `null` when valid. */
  check?: (value: number, values: ExportValues) => string | null;
  section?: string;
}

export interface BooleanOption {
  type: 'boolean';
  name: string;
  label: string;
  default: boolean;
  section?: string;
}

export interface ChoiceOption {
  type: 'choice';
  name: string;
  label: string;
  default: string;
  choices: { value: string; label: string }[];
  /** Short explanation shown under the field. */
  hint?: string;
  section?: string;
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
  /** Built by the backend from the original uploaded image instead of the SVG. */
  source?: 'image';
}

/** Plastic left above a magnet pocket (mm), as in the backend. */
export const MAGNET_ROOF_MM = 0.4;

/** Collapsed groups of the less common 3D options (the rest is always shown):
 * shape, margin, rim, loop and magnet; color order, detail removal, layer snapping and
 * printer fit; placement and encoding of the file. */
const BASE_EXTRAS = 'Base plate extras';
const PRINT_TUNING = 'Print tuning';
const FILE_SECTION = 'File';

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
    section: BASE_EXTRAS,
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
    section: BASE_EXTRAS,
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
    label: 'Color height',
    unit: 'mm',
    default: 1,
    min: 0.1,
    max: 100,
    step: 0.2,
    hint: 'Height of every color above the base plate (each step when stacking colors).',
  },
  {
    type: 'choice',
    name: 'stack_order',
    section: PRINT_TUNING,
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
    name: 'rim_mm',
    section: BASE_EXTRAS,
    label: 'Raised rim width',
    unit: 'mm',
    default: 0,
    min: 0,
    max: 50,
    step: 0.5,
    hint: 'A frame along the edge of the base plate (coasters, signs); colors under it are cut away. 0 = none.',
    check: (value, values) =>
      value > 0 && !(Number(values.base_mm) > 0) ? 'A rim needs a base plate.' : null,
  },
  {
    type: 'number',
    name: 'rim_height_mm',
    section: BASE_EXTRAS,
    label: 'Raised rim height',
    unit: 'mm',
    default: 0,
    min: 0,
    max: 100,
    step: 0.2,
    hint: 'Above the base plate. 0 = as high as the tallest color.',
  },
  {
    type: 'number',
    name: 'loop_hole_mm',
    section: BASE_EXTRAS,
    label: 'Hanging loop hole',
    unit: 'mm',
    default: 0,
    min: 0,
    max: 20,
    step: 0.5,
    hint: 'Adds a loop at the top of the base plate for a keyring or hook, with a hole of this diameter (e.g. 4). 0 = no loop.',
    check: (value, values) =>
      value > 0 && !(Number(values.base_mm) > 0) ? 'A hanging loop needs a base plate.' : null,
  },
  {
    type: 'number',
    name: 'magnet_mm',
    section: BASE_EXTRAS,
    label: 'Magnet pocket diameter',
    unit: 'mm',
    default: 0,
    min: 0,
    max: 50,
    step: 0.1,
    hint: 'Round pocket in the underside of the base plate, e.g. 10.2 for a 10 mm magnet (add ~0.2 mm clearance). 0 = none.',
  },
  {
    type: 'number',
    name: 'magnet_depth_mm',
    section: BASE_EXTRAS,
    label: 'Magnet pocket depth',
    unit: 'mm',
    default: 2,
    min: 0.1,
    max: 20,
    step: 0.1,
    check: (value, values) => {
      const base = snapToLayers(Number(values.base_mm), Number(values.print_layer_mm ?? 0));
      return Number(values.magnet_mm) > 0 && value > base - MAGNET_ROOF_MM + 1e-9
        ? `Needs a base plate of at least ${Number((value + MAGNET_ROOF_MM).toFixed(2))} mm.`
        : null;
    },
  },
  {
    type: 'number',
    name: 'min_feature_mm',
    section: PRINT_TUNING,
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
    section: PRINT_TUNING,
    label: 'Printer layer height',
    unit: 'mm',
    default: 0,
    min: 0,
    max: 1,
    step: 0.04,
    hint: 'Rounds the base and every color to whole layers (e.g. 0.2), so colors change exactly at a layer. 0 keeps exact heights.',
  },
  {
    type: 'number',
    name: 'simplify_mm',
    section: PRINT_TUNING,
    label: 'Simplify outlines',
    unit: 'mm',
    default: 0,
    min: 0,
    max: 2,
    step: 0.05,
    hint: 'Smooths traced outlines to this tolerance (e.g. 0.1): far fewer triangles and smaller files. 0 keeps them exact.',
  },
  {
    type: 'number',
    name: 'color_gap_mm',
    section: PRINT_TUNING,
    label: 'Gap between colors',
    unit: 'mm',
    default: 0,
    min: 0,
    max: 2,
    step: 0.05,
    hint: 'Colors shrink to leave this gap, for pieces printed separately and fitted together. 0 = colors touch.',
  },
  {
    type: 'number',
    name: 'elephant_foot_mm',
    section: PRINT_TUNING,
    label: "Elephant's foot compensation",
    unit: 'mm',
    default: 0,
    min: 0,
    max: 0.5,
    step: 0.05,
    hint: 'Insets the first layer of the base plate (e.g. 0.2), as the squashed first layer bulges out. 0 = off.',
    check: (value, values) =>
      value > 0 && !(Number(values.base_mm) > 0)
        ? "Elephant's foot compensation needs a base plate."
        : null,
  },
  {
    type: 'choice',
    name: 'relief',
    section: PRINT_TUNING,
    label: 'Colors',
    default: 'raised',
    choices: [
      { value: 'raised', label: 'Raised on the base plate' },
      { value: 'inlay', label: 'Inlaid flush into the base plate' },
      { value: 'engrave', label: 'Cut out of the base plate (one filament)' },
    ],
    hint: 'Inlaid colors sink their height into the base plate for a flat top (multi-material printers); the plate must be thicker than the tallest color. Cut-out colors are only missing from the plate — one filament; as deep as the plate cuts through.',
  },
  {
    type: 'choice',
    name: 'origin',
    section: FILE_SECTION,
    label: 'Position',
    default: 'corner',
    choices: [
      { value: 'corner', label: 'From the origin (x, y ≥ 0)' },
      { value: 'center', label: 'Centered on the origin' },
    ],
    hint: 'Centered models suit CAD and CNC tools that keep imported coordinates.',
  },
  {
    type: 'boolean',
    name: 'layered',
    label: 'Stack colors at increasing heights (relief)',
    default: false,
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
    description: '3D model for printing — flat by default; raise any color to its own height.',
    options: [
      ...MODEL_OPTIONS,
      {
        type: 'choice',
        name: 'stl_format',
        section: FILE_SECTION,
        label: 'Encoding',
        default: 'binary',
        choices: [
          { value: 'binary', label: 'Binary (compact)' },
          { value: 'ascii', label: 'ASCII text' },
        ],
        hint: 'ASCII is about five times larger; only for tools that cannot read binary STL.',
      },
    ],
    perColorHeights: true,
  },
  {
    id: '3mf',
    label: '3MF',
    extension: '3mf',
    description:
      'Multi-color 3D model — one colored part per color in one model, ready for AMS/MMU printers.',
    options: [
      ...MODEL_OPTIONS,
      {
        type: 'choice',
        name: 'layout',
        section: FILE_SECTION,
        label: 'Parts',
        default: 'assembly',
        choices: [
          { value: 'assembly', label: 'Parts of one model' },
          { value: 'objects', label: 'Separate objects' },
        ],
        hint: 'Separate objects can be arranged and printed apart in the slicer, e.g. pieces cut with a gap between colors.',
      },
    ],
    perColorHeights: true,
  },
  {
    id: 'lithophane',
    label: 'Lithophane',
    extension: 'lithophane.stl',
    description:
      'Photo plate that shows the original image (not the SVG) when lit from behind: dark areas print thick, bright areas thin. Print upright in white with 100% infill.',
    source: 'image',
    options: [
      {
        type: 'number',
        name: 'width_mm',
        label: 'Width',
        unit: 'mm',
        default: 100,
        min: 1,
        max: 1000,
        step: 1,
      },
      {
        type: 'number',
        name: 'min_thickness_mm',
        label: 'Thinnest (brightest areas)',
        unit: 'mm',
        default: 0.8,
        min: 0.2,
        max: 10,
        step: 0.1,
      },
      {
        type: 'number',
        name: 'max_thickness_mm',
        label: 'Thickest (darkest areas)',
        unit: 'mm',
        default: 3,
        min: 0.3,
        max: 20,
        step: 0.1,
        check: (value, values) =>
          value > Number(values.min_thickness_mm)
            ? null
            : 'Must be thicker than the thinnest areas.',
      },
      {
        type: 'number',
        name: 'resolution_mm',
        label: 'Detail (grid spacing)',
        unit: 'mm',
        default: 0.2,
        min: 0.05,
        max: 5,
        step: 0.05,
        hint: 'About half the nozzle width keeps all detail; smaller values make much larger files.',
      },
      {
        type: 'number',
        name: 'frame_mm',
        label: 'Frame',
        unit: 'mm',
        default: 0,
        min: 0,
        max: 50,
        step: 1,
        hint: 'Solid border at full thickness, so the plate stands and does not warp. 0 = none.',
      },
      {
        type: 'boolean',
        name: 'invert',
        label: 'Invert (bright areas thick, e.g. a relief)',
        default: false,
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
    id: 'eps',
    label: 'EPS',
    extension: 'eps',
    description: 'Encapsulated PostScript with exact curves for design tools and print shops.',
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
        name: 'margin_mm',
        label: 'Margin',
        unit: 'mm',
        default: 0,
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

/** Whether any color has a height of its own (the model is no longer flat). */
export function hasCustomHeights(colors: ColorHeight[]): boolean {
  return colors.some((color) => color.height !== null);
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
