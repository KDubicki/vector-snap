// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { parseSvg } from '../editor/model';
import { sampleDoc } from '../test/fixtures';
import { backgroundGroup, excludedColors, usedColorsError } from './usedColors';

/** Two colors, neither spanning the image: a background removed in the colors step. */
const noBackground = parseSvg(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50">' +
    '<g data-palette-index="2" fill="#00ff00"><path id="p-2-0" d="M0,0 H60 V50 H0 Z"/></g>' +
    '<g data-palette-index="3" fill="#ff0000"><path id="p-3-0" d="M50,10 H90 V40 H50 Z"/></g>' +
    '</svg>',
);

describe('backgroundGroup', () => {
  it('finds a bottom color spanning the whole image', () => {
    expect(backgroundGroup(sampleDoc())).toBe(0);
  });

  it('finds a background above other colors, with holes for them (cutout tracing)', () => {
    const cutout = parseSvg(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50">' +
        '<g data-palette-index="0" fill="#000080"><path id="p-0-0" d="M10,10 H90 V40 H10 Z"/></g>' +
        '<g data-palette-index="1" fill="#ffffff">' +
        '<path id="p-1-0" d="M0,0 H100 V50 H0 Z M10,10 V40 H90 V10 Z"/></g></svg>',
    );
    expect(backgroundGroup(cutout)).toBe(1);
  });

  it('finds none when the bottom color does not span the image or is the only one', () => {
    expect(backgroundGroup(noBackground)).toBeNull();
    const single = sampleDoc();
    expect(backgroundGroup({ ...single, groups: single.groups.slice(0, 1) })).toBeNull();
  });
});

describe('excludedColors', () => {
  it('leaves out the background until colors are chosen', () => {
    expect(excludedColors(sampleDoc(), null)).toEqual([0]);
    expect(excludedColors(noBackground, null)).toEqual([]);
  });

  it('keeps the chosen colors the design still has', () => {
    expect(excludedColors(sampleDoc(), [1, 7])).toEqual([1]);
    expect(excludedColors(sampleDoc(), [])).toEqual([]);
  });
});

describe('usedColorsError', () => {
  it('needs at least one color', () => {
    expect(usedColorsError(sampleDoc(), [0])).toBeNull();
    expect(usedColorsError(sampleDoc(), [0, 1])).toBe('Use at least one color.');
  });
});
