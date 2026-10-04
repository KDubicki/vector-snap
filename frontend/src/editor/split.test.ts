// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { EditorDoc } from './model';
import { splitAlongLine } from './split';

const doc: EditorDoc = {
  width: 40,
  height: 20,
  groups: [
    // background covering everything
    { paletteIndex: 0, fill: '#ffffff', shapes: [{ id: 'bg', d: 'M0,0 L40,0 L40,20 L0,20 Z' }] },
    {
      paletteIndex: 1,
      fill: '#ff0000',
      shapes: [
        { id: 'left', d: 'M5,5 L15,5 L15,15 L5,15 Z' },
        { id: 'right', d: 'M25,5 L35,5 L35,15 L25,15 Z' },
      ],
    },
  ],
};

const vertical = (x: number) => [
  { x, y: 1 },
  { x, y: 19 },
];

describe('splitAlongLine', () => {
  it('splits only fully crossed shapes and leaves the background intact', () => {
    const result = splitAlongLine(doc, vertical(10), []);

    expect(result.split).toBe(1);
    expect(result.created).toEqual(['left.a', 'left.b']);
    expect(result.doc.groups[0]).toBe(doc.groups[0]);
    expect(result.doc.groups[1].shapes.map((s) => s.id)).toEqual(['left.a', 'left.b', 'right']);
  });

  it('splits every shape a long line crosses', () => {
    const line = [
      { x: 1, y: 10 },
      { x: 39, y: 10 },
    ];

    expect(splitAlongLine(doc, line, []).split).toBe(2);
  });

  it('restricts splitting to the candidates', () => {
    const line = [
      { x: 1, y: 10 },
      { x: 39, y: 10 },
    ];

    const result = splitAlongLine(doc, line, ['right']);

    expect(result.created).toEqual(['right.a', 'right.b']);
  });

  it('falls back to all crossed shapes when the selection is not crossed', () => {
    const result = splitAlongLine(doc, vertical(30), ['left']);

    expect(result.created).toEqual(['right.a', 'right.b']);
  });

  it('returns the same document when nothing is crossed', () => {
    const result = splitAlongLine(doc, vertical(20), []);

    expect(result).toEqual({ doc, created: [], split: 0 });
  });
});
