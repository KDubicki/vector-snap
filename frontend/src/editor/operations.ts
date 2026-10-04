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

const PART_SUFFIXES = 'abcdefghijklmnopqrstuvwxyz';

function partIds(doc: EditorDoc, id: string, count: number): string[] {
  const taken = new Set(doc.groups.flatMap((group) => group.shapes.map((shape) => shape.id)));
  const ids: string[] = [];
  for (let n = 0; ids.length < count; n += 1) {
    const letters = n < PART_SUFFIXES.length ? PART_SUFFIXES[n] : `p${n}`;
    const candidate = `${id}.${letters}`;
    if (!taken.has(candidate)) ids.push(candidate);
  }
  return ids;
}

/**
 * Replace a shape by several parts at the same z-position (used by splitting).
 * Parts inherit the shape's own color and get derived ids: "p-3-12.a", "p-3-12.b", ...
 */
export function replaceShape(
  doc: EditorDoc,
  id: string,
  parts: string[],
): { doc: EditorDoc; ids: string[] } {
  const ids = partIds(doc, id, parts.length);
  let replaced = false;
  const groups = doc.groups.map((group) => {
    const index = group.shapes.findIndex((shape) => shape.id === id);
    if (index < 0) return group;
    replaced = true;
    const original = group.shapes[index];
    const created = parts.map((d, i) => ({ ...original, id: ids[i], d }));
    return {
      ...group,
      shapes: [...group.shapes.slice(0, index), ...created, ...group.shapes.slice(index + 1)],
    };
  });
  return replaced ? { doc: { ...doc, groups }, ids } : { doc, ids: [] };
}

/** Remove shapes (FR-36). Groups left without shapes are removed as well. */
export function deleteShapes(doc: EditorDoc, ids: string[]): EditorDoc {
  const remove = new Set(ids);
  return {
    ...doc,
    groups: doc.groups
      .map((group) =>
        group.shapes.some((shape) => remove.has(shape.id))
          ? { ...group, shapes: group.shapes.filter((shape) => !remove.has(shape.id)) }
          : group,
      )
      .filter((group) => group.shapes.length > 0),
  };
}

/**
 * Replace several shapes by one merged shape (FR-35). The merged shape keeps the id,
 * group, own color and z-position of `keepId` (the caller passes the largest shape).
 */
export function mergeShapes(doc: EditorDoc, ids: string[], keepId: string, d: string): EditorDoc {
  const others = new Set(ids.filter((id) => id !== keepId));
  return {
    ...doc,
    groups: doc.groups
      .map((group) => {
        const touched = group.shapes.some((shape) => others.has(shape.id) || shape.id === keepId);
        if (!touched) return group;
        return {
          ...group,
          shapes: group.shapes
            .filter((shape) => !others.has(shape.id))
            .map((shape) => (shape.id === keepId ? { ...shape, d } : shape)),
        };
      })
      .filter((group) => group.shapes.length > 0),
  };
}

/**
 * Move shapes into another color group (on top of it) and drop their own color, so they
 * take the group's color. Unknown target groups leave the document unchanged.
 */
export function moveShapesToGroup(doc: EditorDoc, ids: string[], paletteIndex: number): EditorDoc {
  if (!doc.groups.some((group) => group.paletteIndex === paletteIndex)) return doc;
  const moving = new Set(ids);
  const moved = doc.groups
    .flatMap((group) => group.shapes)
    .filter((shape) => moving.has(shape.id))
    .map(withoutFill);
  if (!moved.length) return doc;
  return {
    ...doc,
    groups: doc.groups
      .map((group) => {
        const kept = group.shapes.filter((shape) => !moving.has(shape.id));
        if (group.paletteIndex === paletteIndex) return { ...group, shapes: [...kept, ...moved] };
        return kept.length === group.shapes.length ? group : { ...group, shapes: kept };
      })
      .filter((group) => group.shapes.length > 0),
  };
}
