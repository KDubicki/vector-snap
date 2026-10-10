/**
 * Moving shapes (placing fragments, adjusting parts). Transforms are affine matrices
 * applied to the path data, so the document stays plain SVG paths. See docs/08-svg-editor.md#transforming-shapes.
 */
import { pathsBounds, transformPath, type Bounds, type Matrix } from './geometry';
import type { EditorDoc } from './model';

export function translation(dx: number, dy: number): Matrix {
  return [1, 0, 0, 1, dx, dy];
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
