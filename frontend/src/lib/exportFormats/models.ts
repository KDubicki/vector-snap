/** 3D models to print: STL, 3MF, lithophane and cookie cutter. */

import { FILE_SECTION, MODEL_OPTIONS } from './modelOptions';
import type { ExportFormat } from './types';

export const MODEL_FORMATS: ExportFormat[] = [
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
    id: 'cookie-cutter',
    label: 'Cookie cutter',
    extension: 'cookie-cutter.stl',
    description:
      'Cutter following the outline of the whole design: a thin blade on a flange, printed flange down. Leave out the background below, or the cutter is the whole image.',
    colorChoice: true,
    options: [
      {
        type: 'number',
        name: 'width_mm',
        label: 'Cookie width',
        unit: 'mm',
        default: 80,
        min: 10,
        max: 500,
        step: 1,
      },
      {
        type: 'number',
        name: 'height_mm',
        label: 'Height',
        unit: 'mm',
        default: 15,
        min: 3,
        max: 60,
        step: 1,
      },
      {
        type: 'number',
        name: 'wall_mm',
        label: 'Blade thickness',
        unit: 'mm',
        default: 1.2,
        min: 0.4,
        max: 5,
        step: 0.1,
        hint: 'At least 2–3 nozzle widths, so the blade is stiff.',
      },
      {
        type: 'number',
        name: 'flange_mm',
        label: 'Flange width',
        unit: 'mm',
        default: 4,
        min: 0,
        max: 20,
        step: 0.5,
        hint: 'Brim at the foot to press on. 0 = blade only.',
      },
      {
        type: 'number',
        name: 'flange_height_mm',
        label: 'Flange height',
        unit: 'mm',
        default: 2,
        min: 0.4,
        max: 20,
        step: 0.2,
        check: (value, values) =>
          Number(values.flange_mm) === 0 || value < Number(values.height_mm)
            ? null
            : 'Must be lower than the cutter.',
      },
      {
        type: 'number',
        name: 'smooth_mm',
        label: 'Smooth notches',
        unit: 'mm',
        default: 1,
        min: 0,
        max: 10,
        step: 0.5,
        hint: 'Closes gaps narrower than twice this: dough cannot follow them.',
      },
      {
        type: 'boolean',
        name: 'mirror',
        label: 'Mirror, so the cookie comes out as the design (text reads right)',
        default: true,
      },
    ],
  },
];
