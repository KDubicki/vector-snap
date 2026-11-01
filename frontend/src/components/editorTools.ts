/** The SVG editor's tools, as the toolbar shows them and their keys select them. */

/** Zoom factor of one wheel notch, toolbar click or `+`/`-` key. */
export const WHEEL_ZOOM_STEP = 1.15;

export type Tool = 'select' | 'hand' | 'knife' | 'lasso' | 'eyedropper';

export const TOOLS: { id: Tool; label: string; key: string; title: string; hint: string }[] = [
  {
    id: 'select',
    label: 'Select',
    key: 'v',
    title: 'Select (V): click a shape or drag a box around shapes',
    hint: 'Click to select · drag a box to select · drag the selection to move it (arrows nudge) · Shift adds · Space+drag pans',
  },
  {
    id: 'hand',
    label: 'Hand',
    key: 'h',
    title: 'Hand (H): drag to pan',
    hint: 'Drag to pan · scroll to zoom',
  },
  {
    id: 'knife',
    label: 'Knife',
    key: 'k',
    title: 'Knife (K): draw a line across shapes to split them',
    hint: 'Draw across shapes to split them · Shift: straight line · Space+drag pans',
  },
  {
    id: 'lasso',
    label: 'Lasso',
    key: 'l',
    title: 'Lasso (L): draw around part of a shape to cut it out',
    hint: 'Start on a shape (or select shapes first) and draw around the part to cut out',
  },
  {
    id: 'eyedropper',
    label: 'Eyedropper',
    key: 'i',
    title: 'Eyedropper (I): click a shape to give the selected shapes its color',
    hint: 'Select shapes, then click the shape whose color they should take · Space+drag pans',
  },
];
