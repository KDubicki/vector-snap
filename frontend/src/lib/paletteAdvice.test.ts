import { describe, expect, it } from 'vitest';
import { COMMON_FILAMENTS } from './filamentLibrary';
import {
  mergeOverrides,
  nearestFilaments,
  similarPairs,
  tinyColors,
  type PaletteEntry,
} from './paletteAdvice';

// The palette of a user's photo (k-means, 6 colors): two olive shades of one area.
const PHOTO: PaletteEntry[] = [
  { index: 0, hex: '#fafbf9', coverage: 0.53 },
  { index: 1, hex: '#050503', coverage: 0.218 },
  { index: 2, hex: '#5f8414', coverage: 0.076 },
  { index: 3, hex: '#50643b', coverage: 0.062 },
  { index: 4, hex: '#c9cf3a', coverage: 0.06 },
  { index: 5, hex: '#eab322', coverage: 0.055 },
];

describe('palette advice', () => {
  it('pairs similar shades, keeping the larger one', () => {
    const pairs = similarPairs(PHOTO);

    // The olive shades merge; yellow-green and gold (ΔE 16.6) stay two colors.
    expect(pairs.map((pair) => [pair.merge.hex, pair.keep.hex])).toEqual([['#50643b', '#5f8414']]);
    expect(pairs[0].delta).toBeGreaterThan(8); // similar, not identical
  });

  it('puts every color in at most one pair, most alike first', () => {
    const navy: PaletteEntry[] = [
      { index: 0, hex: '#1d2b53', coverage: 0.4 },
      { index: 1, hex: '#1c1e50', coverage: 0.05 },
      { index: 2, hex: '#2c4062', coverage: 0.03 },
    ];

    const pairs = similarPairs(navy);

    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toMatchObject({ keep: { index: 0 }, merge: { index: 1 } });
    expect(pairs[0].delta).toBeLessThan(8);
  });

  it('ignores colors that are already merged', () => {
    const merged = PHOTO.map((entry) => (entry.index === 3 ? { ...entry, hex: '#5f8414' } : entry));

    expect(similarPairs(merged)).toEqual([]);
    expect(similarPairs([PHOTO[0]])).toEqual([]);
  });

  it('suggests merging tiny areas into the nearest color', () => {
    const withSpeck = [...PHOTO, { index: 6, hex: '#d0d84a', coverage: 0.002 }];

    expect(tinyColors(withSpeck)).toEqual([
      expect.objectContaining({ merge: expect.objectContaining({ index: 6 }), keep: PHOTO[4] }),
    ]);
    expect(tinyColors(PHOTO)).toEqual([]);
    expect(tinyColors([{ index: 0, hex: '#000000', coverage: 0.001 }])).toEqual([]);
  });

  it('finds the nearest filament for every color', () => {
    const nearest = nearestFilaments(PHOTO, COMMON_FILAMENTS);

    expect(nearest.get(0)?.filament.name).toBe('White');
    expect(nearest.get(1)?.filament.name).toBe('Black');
    expect(nearest.get(2)?.filament.name).toBe('Olive');
    expect(nearest.get(5)?.filament.name).toBe('Gold');
    expect(nearestFilaments(PHOTO, []).size).toBe(0);
  });

  it('turns a merge into overrides for every entry of the merged color', () => {
    const entries = [...PHOTO, { index: 6, hex: '#50643b', coverage: 0.01 }];
    const [pair] = similarPairs(entries);

    expect(mergeOverrides(entries, pair)).toEqual({ 3: '#5f8414', 6: '#5f8414' });
  });
});
