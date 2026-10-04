import { describe, expect, it } from 'vitest';
import type { EditorDoc } from './model';
import {
  deleteShapes,
  mergeShapes,
  moveShapesToGroup,
  recolorGroup,
  recolorShapes,
  replaceShape,
  resetShapeColors,
} from './operations';

const doc: EditorDoc = {
  width: 10,
  height: 10,
  groups: [
    {
      paletteIndex: 0,
      fill: '#ff0000',
      shapes: [
        { id: 'a', d: 'M0,0 Z' },
        { id: 'b', d: 'M1,1 Z', fill: '#00ff00' },
      ],
    },
    { paletteIndex: 1, fill: '#0000ff', shapes: [{ id: 'c', d: 'M2,2 Z' }] },
  ],
};

describe('recolorShapes', () => {
  it('sets an own color on the given shapes only', () => {
    const next = recolorShapes(doc, ['a', 'c'], '#ABCDEF');

    expect(next.groups[0].shapes[0].fill).toBe('#abcdef');
    expect(next.groups[0].shapes[1].fill).toBe('#00ff00');
    expect(next.groups[1].shapes[0].fill).toBe('#abcdef');
  });

  it('drops the override when the color equals the group color', () => {
    const next = recolorShapes(doc, ['b'], '#FF0000');

    expect(next.groups[0].shapes[1]).toEqual({ id: 'b', d: 'M1,1 Z' });
  });

  it('does not mutate the input and keeps untouched groups by reference', () => {
    const next = recolorShapes(doc, ['a'], '#123456');

    expect(doc.groups[0].shapes[0].fill).toBeUndefined();
    expect(next.groups[1]).toBe(doc.groups[1]);
  });
});

describe('resetShapeColors', () => {
  it('makes shapes follow their group again', () => {
    const next = resetShapeColors(doc, ['b']);

    expect(next.groups[0].shapes[1].fill).toBeUndefined();
  });
});

describe('recolorGroup', () => {
  it('changes the group color and keeps own colors', () => {
    const next = recolorGroup(doc, 0, '#111111');

    expect(next.groups[0].fill).toBe('#111111');
    expect(next.groups[0].shapes[1].fill).toBe('#00ff00');
    expect(next.groups[1]).toBe(doc.groups[1]);
  });

  it('drops overrides that now match the group color', () => {
    const next = recolorGroup(doc, 0, '#00FF00');

    expect(next.groups[0].shapes[1].fill).toBeUndefined();
  });
});

describe('replaceShape', () => {
  it('replaces a shape by parts at the same position with derived ids', () => {
    const { doc: next, ids } = replaceShape(doc, 'b', ['M1,1 Z', 'M2,2 Z']);

    expect(ids).toEqual(['b.a', 'b.b']);
    expect(next.groups[0].shapes).toEqual([
      { id: 'a', d: 'M0,0 Z' },
      { id: 'b.a', d: 'M1,1 Z', fill: '#00ff00' },
      { id: 'b.b', d: 'M2,2 Z', fill: '#00ff00' },
    ]);
    expect(next.groups[1]).toBe(doc.groups[1]);
  });

  it('skips ids that already exist', () => {
    const taken: EditorDoc = {
      ...doc,
      groups: [{ ...doc.groups[0], shapes: [...doc.groups[0].shapes, { id: 'a.a', d: '' }] }],
    };

    expect(replaceShape(taken, 'a', ['M0,0 Z', 'M1,1 Z']).ids).toEqual(['a.b', 'a.c']);
  });

  it('uses numbered suffixes after z', () => {
    const parts = Array.from({ length: 28 }, () => 'M0,0 Z');

    expect(replaceShape(doc, 'a', parts).ids.slice(-2)).toEqual(['a.p26', 'a.p27']);
  });

  it('returns the document unchanged for unknown ids', () => {
    const result = replaceShape(doc, 'missing', ['M0,0 Z']);

    expect(result.doc).toBe(doc);
    expect(result.ids).toEqual([]);
  });
});

describe('deleteShapes', () => {
  it('removes shapes and groups that become empty', () => {
    const next = deleteShapes(doc, ['a', 'c']);

    expect(next.groups).toHaveLength(1);
    expect(next.groups[0].shapes.map((s) => s.id)).toEqual(['b']);
  });

  it('keeps untouched groups by reference', () => {
    const next = deleteShapes(doc, ['c']);

    expect(next.groups).toEqual([doc.groups[0]]);
    expect(next.groups[0]).toBe(doc.groups[0]);
  });
});

describe('mergeShapes', () => {
  it('replaces the shapes by one that keeps the id, color and position of keepId', () => {
    const next = mergeShapes(doc, ['a', 'b', 'c'], 'b', 'M9,9 Z');

    expect(next.groups).toHaveLength(1);
    expect(next.groups[0].shapes).toEqual([{ id: 'b', d: 'M9,9 Z', fill: '#00ff00' }]);
  });

  it('keeps untouched groups by reference', () => {
    const next = mergeShapes(doc, ['a', 'b'], 'a', 'M9,9 Z');

    expect(next.groups[0].shapes).toEqual([{ id: 'a', d: 'M9,9 Z' }]);
    expect(next.groups[1]).toBe(doc.groups[1]);
  });
});

describe('moveShapesToGroup', () => {
  it('moves shapes on top of the target group and drops their own color', () => {
    const next = moveShapesToGroup(doc, ['b'], 1);

    expect(next.groups[0].shapes.map((s) => s.id)).toEqual(['a']);
    expect(next.groups[1].shapes).toEqual([
      { id: 'c', d: 'M2,2 Z' },
      { id: 'b', d: 'M1,1 Z' },
    ]);
  });

  it('removes groups that become empty', () => {
    const next = moveShapesToGroup(doc, ['c'], 0);

    expect(next.groups).toHaveLength(1);
    expect(next.groups[0].shapes.map((s) => s.id)).toEqual(['a', 'b', 'c']);
  });

  it('ignores unknown groups and shapes', () => {
    expect(moveShapesToGroup(doc, ['a'], 7)).toBe(doc);
    expect(moveShapesToGroup(doc, ['missing'], 1)).toBe(doc);
  });
});
