// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { pathArea, pathsBounds } from './geometry';
import type { EditorDoc } from './model';
import {
  SCALE_STEP,
  shapesBounds,
  transformMatrix,
  transformShapes,
  translation,
} from './transform';

// 10 x 20 rectangle at (10, 0)
const RECT = 'M10,0 L20,0 L20,20 L10,20 Z';
const doc: EditorDoc = {
  width: 100,
  height: 100,
  groups: [
    {
      paletteIndex: 0,
      fill: '#ffffff',
      shapes: [
        { id: 'a', d: RECT },
        { id: 'b', d: 'M50,50 L60,50 L60,60 L50,60 Z' },
      ],
    },
  ],
};

const boundsOf = (d: EditorDoc, id: string) => shapesBounds(d, [id]);

describe('transforming shapes', () => {
  it('moves only the given shapes', () => {
    const moved = transformShapes(doc, ['a'], translation(5, -2));

    expect(boundsOf(moved, 'a')).toEqual({ x: 15, y: -2, width: 10, height: 20 });
    expect(moved.groups[0].shapes[1]).toBe(doc.groups[0].shapes[1]);
  });

  it('scales around the center of the selection', () => {
    const bounds = pathsBounds([RECT])!;
    const larger = transformShapes(doc, ['a'], transformMatrix('larger', bounds));
    const box = boundsOf(larger, 'a')!;

    expect(box.width).toBeCloseTo(10 * SCALE_STEP, 1);
    expect(box.x + box.width / 2).toBeCloseTo(15, 1);
    expect(box.y + box.height / 2).toBeCloseTo(10, 1);
    const smaller = transformShapes(larger, ['a'], transformMatrix('smaller', box));
    expect(boundsOf(smaller, 'a')!.width).toBeCloseTo(10, 1);
  });

  it('rotates by 90 degrees and flips in place', () => {
    const bounds = pathsBounds([RECT])!;
    const rotated = transformShapes(doc, ['a'], transformMatrix('rotate', bounds));

    expect(boundsOf(rotated, 'a')).toEqual({ x: 5, y: 5, width: 20, height: 10 });
    for (const kind of ['flip-x', 'flip-y'] as const) {
      const flipped = transformShapes(doc, ['a'], transformMatrix(kind, bounds));
      expect(boundsOf(flipped, 'a')).toEqual(bounds);
      expect(pathArea(flipped.groups[0].shapes[0].d)).toBeCloseTo(200);
    }
  });

  it('has no bounds for unknown shapes', () => {
    expect(shapesBounds(doc, ['missing'])).toBeNull();
    expect(shapesBounds(doc, ['a', 'b'])).toEqual({ x: 10, y: 0, width: 50, height: 60 });
  });
});
