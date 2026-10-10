// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { EditorDoc } from './model';
import { shapesBounds, transformShapes, translation } from './transform';

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

  it('has no bounds for unknown shapes', () => {
    expect(shapesBounds(doc, ['missing'])).toBeNull();
    expect(shapesBounds(doc, ['a', 'b'])).toEqual({ x: 10, y: 0, width: 50, height: 60 });
  });
});
