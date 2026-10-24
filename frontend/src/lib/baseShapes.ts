/** Base plate shapes of 3D exports (`base_shape`), shared by the print step, the export
 * panel and print settings files. See docs/13-export-formats.md. */

export const BASE_SHAPES = [
  { value: 'outline', label: 'Follow the design' },
  { value: 'rectangle', label: 'Rectangle' },
  { value: 'rounded', label: 'Rounded rectangle' },
  { value: 'circle', label: 'Circle' },
  { value: 'oval', label: 'Oval' },
  { value: 'hexagon', label: 'Hexagon' },
] as const;

export type BaseShape = (typeof BASE_SHAPES)[number]['value'];
