/**
 * Pure editing operations: each returns a new `EditorDoc` and never mutates its input,
 * so documents can be kept as undo snapshots. See docs/08-svg-editor.md.
 */
import type { ColorGroup, EditorDoc, Shape } from './model';

function mapShapes(
  doc: EditorDoc,
  ids: ReadonlySet<string>,
  update: (shape: Shape, group: ColorGroup) => Shape,
): EditorDoc {
  return {
    ...doc,
    groups: doc.groups.map((group) =>
      group.shapes.some((shape) => ids.has(shape.id))
        ? {
            ...group,
            shapes: group.shapes.map((shape) => (ids.has(shape.id) ? update(shape, group) : shape)),
          }
        : group,
    ),
  };
}

function withoutFill(shape: Shape): Shape {
  const copy = { ...shape };
  delete copy.fill;
  return copy;
}

/**
 * Give the shapes their own color (FR-33). A color equal to the group color removes the
 * override, so the shape follows later group recolors again.
 */
export function recolorShapes(doc: EditorDoc, ids: string[], fill: string): EditorDoc {
  const color = fill.toLowerCase();
  return mapShapes(doc, new Set(ids), (shape, group) =>
    color === group.fill ? withoutFill(shape) : { ...shape, fill: color },
  );
}

/** Make the shapes follow their group color again. */
export function resetShapeColors(doc: EditorDoc, ids: string[]): EditorDoc {
  return mapShapes(doc, new Set(ids), withoutFill);
}

/**
 * Recolor a whole palette group (FR-34). Shapes with their own color keep it; overrides
 * that now equal the group color are dropped.
 */
export function recolorGroup(doc: EditorDoc, paletteIndex: number, fill: string): EditorDoc {
  const color = fill.toLowerCase();
  return {
    ...doc,
    groups: doc.groups.map((group) =>
      group.paletteIndex === paletteIndex
        ? {
            ...group,
            fill: color,
            shapes: group.shapes.map((shape) =>
              shape.fill === color ? withoutFill(shape) : shape,
            ),
          }
        : group,
    ),
  };
}
