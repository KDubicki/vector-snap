import { describe, expect, it } from 'vitest';
import type { EditorDoc } from './model';
import { recolorGroup, recolorShapes, resetShapeColors } from './operations';

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
