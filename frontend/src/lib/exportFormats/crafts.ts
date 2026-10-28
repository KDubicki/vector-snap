/** Sheets to cut, stack or color in: a file per color, sticker, stencil and coloring page. */

import type { ExportFormat } from './types';

export const CRAFT_FORMATS: ExportFormat[] = [
  {
    id: 'layers',
    label: 'Colors (ZIP)',
    extension: 'colors.zip',
    description:
      'One file per color on the same canvas, so they line up when stacked: vinyl cutters, screen printing, laser cutting a material per color. colors.txt lists each color with its area.',
    options: [
      {
        type: 'choice',
        name: 'layer_format',
        label: 'File format',
        default: 'svg',
        choices: [
          { value: 'svg', label: 'SVG' },
          { value: 'dxf', label: 'DXF' },
          { value: 'pdf', label: 'PDF' },
        ],
      },
      {
        type: 'number',
        name: 'width_mm',
        label: 'Width (DXF, PDF)',
        unit: 'mm',
        default: 100,
        min: 1,
        max: 10000,
        step: 1,
      },
    ],
  },
  {
    id: 'sticker',
    label: 'Sticker',
    extension: 'sticker.svg',
    extensionFor: (values) => `sticker.${String(values.sticker_format)}`,
    description:
      'Print-and-cut sticker: the design on a border around its outline, with a CutContour cut line for Cricut, Silhouette and print-and-cut plotters.',
    colorChoice: true,
    options: [
      {
        type: 'choice',
        name: 'sticker_format',
        label: 'File format',
        default: 'svg',
        choices: [
          { value: 'svg', label: 'SVG' },
          { value: 'pdf', label: 'PDF' },
        ],
        hint: 'PDF has CutContour as a spot color, for Roland, Mimaki and Summa cutters.',
      },
      {
        type: 'number',
        name: 'width_mm',
        label: 'Design width',
        unit: 'mm',
        default: 70,
        min: 5,
        max: 1000,
        step: 1,
      },
      {
        type: 'number',
        name: 'border_mm',
        label: 'Border',
        unit: 'mm',
        default: 3,
        min: 0,
        max: 50,
        step: 0.5,
        hint: 'Background around the design. 0 = cut along the design.',
      },
      {
        type: 'choice',
        name: 'background',
        label: 'Border color',
        default: '#ffffff',
        choices: [
          { value: '#ffffff', label: 'White' },
          { value: '#000000', label: 'Black' },
        ],
      },
    ],
  },
  {
    id: 'stencil',
    label: 'Stencil',
    extension: 'stencil.svg',
    extensionFor: (values) =>
      values.per_color ? 'stencils.zip' : `stencil.${String(values.stencil_format)}`,
    description:
      'Sheets with the design cut out, for spray paint or screen printing: one per color on the same sheet, so the edges line them up. Islands such as the middle of an O are held by bridges so they do not fall out.',
    colorChoice: true,
    options: [
      {
        type: 'choice',
        name: 'stencil_format',
        label: 'File format',
        default: 'svg',
        choices: [
          { value: 'svg', label: 'SVG' },
          { value: 'dxf', label: 'DXF' },
        ],
      },
      {
        type: 'number',
        name: 'width_mm',
        label: 'Design width',
        unit: 'mm',
        default: 100,
        min: 5,
        max: 10000,
        step: 1,
      },
      {
        type: 'boolean',
        name: 'per_color',
        label: 'One stencil per color (ZIP), painted one after the other',
        default: true,
      },
      {
        type: 'number',
        name: 'bridge_mm',
        label: 'Bridge width',
        unit: 'mm',
        default: 1.5,
        min: 0.2,
        max: 20,
        step: 0.1,
      },
      {
        type: 'choice',
        name: 'bridges',
        label: 'Bridges',
        default: 'horizontal',
        choices: [
          { value: 'horizontal', label: 'Horizontal' },
          { value: 'vertical', label: 'Vertical' },
          { value: 'both', label: 'Both' },
        ],
        hint: 'Both is sturdier, with more to touch up after painting.',
      },
      {
        type: 'number',
        name: 'margin_mm',
        label: 'Sheet margin',
        unit: 'mm',
        default: 10,
        min: 1,
        max: 100,
        step: 1,
      },
    ],
  },
  {
    id: 'coloring-page',
    label: 'Coloring page',
    extension: 'coloring.pdf',
    description:
      'Outlines of every color region on a page, to color in — or paint by numbers, with a numbered legend of the colors. Colors left out stay white.',
    colorChoice: true,
    options: [
      {
        type: 'boolean',
        name: 'numbers',
        label: 'Paint by numbers (numbers and a legend)',
        default: true,
      },
      {
        type: 'choice',
        name: 'page',
        label: 'Page',
        default: 'a4',
        choices: [
          { value: 'a4', label: 'A4' },
          { value: 'letter', label: 'Letter' },
        ],
      },
      {
        type: 'number',
        name: 'line_mm',
        label: 'Line width',
        unit: 'mm',
        default: 0.4,
        min: 0.1,
        max: 3,
        step: 0.1,
      },
    ],
  },
];
