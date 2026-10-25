// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { parseSvg } from './model';
import { findSimilarColors, mergeSimilarColors } from './similarColors';

/** White background, a near-white patch, a red square with an almost red own color. */
const doc = () =>
  parseSvg(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50">' +
      '<g data-palette-index="0" fill="#ffffff"><path id="bg" d="M0,0 H100 V50 H0 Z"/></g>' +
      '<g data-palette-index="1" fill="#ff0000">' +
      '<path id="red" d="M10,10 H30 V30 H10 Z"/>' +
      '<path id="own" d="M50,10 H60 V20 H50 Z" fill="#fe0101"/></g>' +
      '<g data-palette-index="2" fill="#fefefe"><path id="patch" d="M70,10 H80 V20 H70 Z"/></g>' +
      '</svg>',
  );

describe('findSimilarColors', () => {
  it('finds groups and own colors closer than the limit', () => {
    const similar = findSimilarColors(doc(), 2);

    expect(similar.groups).toEqual([
      expect.objectContaining({
        paletteIndex: 2,
        fill: '#fefefe',
        intoIndex: 0,
        intoFill: '#ffffff',
      }),
    ]);
    expect(similar.groups[0].deltaE).toBeLessThan(1);
    expect(similar.shapes).toEqual(['own']);
  });

  it('finds nothing when off or when the colors differ enough', () => {
    expect(findSimilarColors(doc(), 0)).toEqual({ groups: [], shapes: [] });
    expect(findSimilarColors(doc(), 0.1)).toEqual({ groups: [], shapes: [] });
  });

  it('keeps the group covering more and follows chains', () => {
    const chain = parseSvg(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50">' +
        '<g data-palette-index="0" fill="#808080"><path id="a" d="M0,0 H10 V10 H0 Z"/></g>' +
        '<g data-palette-index="1" fill="#828282"><path id="b" d="M0,0 H20 V20 H0 Z"/></g>' +
        '<g data-palette-index="2" fill="#858585"><path id="c" d="M0,0 H50 V50 H0 Z"/></g>' +
        '</svg>',
    );
    const groups = findSimilarColors(chain, 2).groups;

    expect(groups.map((group) => [group.paletteIndex, group.intoIndex])).toEqual([
      [0, 2],
      [1, 2],
    ]);
  });
});

describe('mergeSimilarColors', () => {
  it('moves merged shapes on top of the group they join and drops own colors', () => {
    const before = doc();
    const merged = mergeSimilarColors(before, findSimilarColors(before, 2));

    expect(merged.groups.map((group) => group.paletteIndex)).toEqual([0, 1]);
    expect(merged.groups[0].shapes.map((shape) => shape.id)).toEqual(['bg', 'patch']);
    expect(merged.groups[1].shapes.find((shape) => shape.id === 'own')?.fill).toBeUndefined();
    expect(before.groups).toHaveLength(3);
  });

  it('keeps own colors that differ and returns the same document without merges', () => {
    const before = doc();
    const merged = mergeSimilarColors(before, {
      groups: findSimilarColors(before, 2).groups,
      shapes: [],
    });

    expect(merged.groups[1].shapes.find((shape) => shape.id === 'own')?.fill).toBe('#fe0101');
    expect(mergeSimilarColors(before, { groups: [], shapes: [] })).toBe(before);
  });
});
