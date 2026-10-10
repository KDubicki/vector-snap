/**
 * Moving, scaling, flipping and rotating shapes (placing fragments, adjusting parts).
 * Transforms are affine matrices applied to the path data, so the document stays plain
 * SVG paths. See docs/08-svg-editor.md#transforming-shapes.
 */
import { pathsBounds, transformPath, type Bounds, type Matrix } from './geometry';
import type { EditorDoc } from './model';

/** Size change of one "Larger"/"Smaller" step. */
export const SCALE_STEP = 1.1;

export type SelectionTransform = 'larger' | 'smaller' | 'flip-x' | 'flip-y' | 'rotate';

export function translation(dx: number, dy: number): Matrix {
  return [1, 0, 0, 1, dx, dy];
}

/** Matrix of a transform around the center of `bounds` (y axis points down). */
export function transformMatrix(kind: SelectionTransform, bounds: Bounds): Matrix {
  const cx = bounds.x + bounds.width / 2;
  const cy = bounds.y + bounds.height / 2;
  const scale = (s: number): Matrix => [s, 0, 0, s, cx - s * cx, cy - s * cy];
  switch (kind) {
    case 'larger':
      return scale(SCALE_STEP);
    case 'smaller':
      return scale(1 / SCALE_STEP);
    case 'flip-x':
      return [-1, 0, 0, 1, 2 * cx, 0];
    case 'flip-y':
      return [1, 0, 0, -1, 0, 2 * cy];
    case 'rotate':
      // 90° clockwise on screen: x' = cx - (y - cy), y' = cy + (x - cx).
      return [0, 1, -1, 0, cx + cy, cy - cx];
  }
}

/** Apply a matrix to the shapes with the given ids; everything else is shared unchanged. */
export function transformShapes(doc: EditorDoc, ids: string[], matrix: Matrix): EditorDoc {
  const wanted = new Set(ids);
  return {
    ...doc,
    groups: doc.groups.map((group) =>
      group.shapes.some((shape) => wanted.has(shape.id))
        ? {
            ...group,
            shapes: group.shapes.map((shape) =>
              wanted.has(shape.id) ? { ...shape, d: transformPath(shape.d, matrix) } : shape,
            ),
          }
        : group,
    ),
  };
}

/** Bounding box of the shapes with the given ids, or `null` when none exist. */
export function shapesBounds(doc: EditorDoc, ids: string[]): Bounds | null {
  const wanted = new Set(ids);
  return pathsBounds(
    doc.groups
      .flatMap((group) => group.shapes)
      .filter((shape) => wanted.has(shape.id))
      .map((shape) => shape.d),
  );
}
