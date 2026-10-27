// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { closestFilament, filamentChanges, snapToFilaments } from './filamentSnap';
import { parseSvg } from './model';

const WHITE = { name: 'White', color: '#f7f7f5' };
const RED = { name: 'Red', color: '#c12e1f' };
const BLACK = { name: 'Black', color: '#1b1b1b' };

/** White background, two reds and a dark red own color inside the second red. */
const doc = () =>
  parseSvg(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50">' +
      '<g data-palette-index="0" fill="#ffffff"><path id="bg" d="M0,0 H100 V50 H0 Z"/></g>' +
      '<g data-palette-index="1" fill="#d02020"><path id="a" d="M10,10 H40 V40 H10 Z"/></g>' +
      '<g data-palette-index="2" fill="#b83020">' +
      '<path id="b" d="M50,10 H60 V20 H50 Z"/>' +
      '<path id="own" d="M70,10 H80 V20 H70 Z" fill="#c02a1a"/></g>' +
      '</svg>',
  );

describe('filament snapping', () => {
  it('finds the closest filament', () => {
    expect(closestFilament('#101010', [WHITE, RED, BLACK]).filament).toBe(BLACK);
  });

  it('lists what every color becomes', () => {
    const changes = filamentChanges(doc(), [WHITE, RED, BLACK]);

    expect(changes.map((change) => [change.fill, change.filament.name])).toEqual([
      ['#ffffff', 'White'],
      ['#d02020', 'Red'],
      ['#b83020', 'Red'],
    ]);
    expect(filamentChanges(doc(), [])).toEqual([]);
  });

  it('recolors to the filaments and joins groups of one filament', () => {
    const snapped = snapToFilaments(doc(), [WHITE, RED, BLACK]);

    expect(snapped.groups.map((group) => [group.paletteIndex, group.fill])).toEqual([
      [0, '#f7f7f5'],
      [1, '#c12e1f'],
    ]);
    const red = snapped.groups[1].shapes;
    expect(red.map((shape) => shape.id)).toEqual(['a', 'b', 'own']);
    expect(red.every((shape) => shape.fill === undefined)).toBe(true); // own color followed
  });

  it('leaves a document already in the filaments as it is', () => {
    const once = snapToFilaments(doc(), [WHITE, RED, BLACK]);

    expect(snapToFilaments(once, [WHITE, RED, BLACK])).toBe(once);
    expect(snapToFilaments(doc(), [])).toEqual(doc());
  });
});
