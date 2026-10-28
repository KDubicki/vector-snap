/** 2D files for other tools: palette, DXF, PDF, EPS and PNG (rendered in the browser). */

import type { ExportFormat } from './types';

export const DRAWING_FORMATS: ExportFormat[] = [
  {
    id: 'palette',
    label: 'Palette',
    extension: 'palette.gpl',
    extensionFor: (values) => `palette.${String(values.palette_format)}`,
    description:
      'The design’s colors as swatches for other tools, in order, with the share each covers.',
    options: [
      {
        type: 'choice',
        name: 'palette_format',
        label: 'File format',
        default: 'gpl',
        choices: [
          { value: 'gpl', label: 'GIMP / Inkscape' },
          { value: 'ase', label: 'Adobe (ASE)' },
          { value: 'css', label: 'CSS' },
          { value: 'json', label: 'JSON' },
        ],
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
