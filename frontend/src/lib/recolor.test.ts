import { describe, expect, it } from 'vitest';
import { clearBorderRegions, recolorPixels } from './recolor';

const pixels = (...values: number[]) => new Uint8ClampedArray(values);

describe('recolorPixels', () => {
  it('replaces each palette color with its target color', () => {
    const source = pixels(255, 0, 0, 255, 0, 255, 0, 255);

    const result = recolorPixels(source, ['#ff0000', '#00ff00'], ['#000000', '#00ff00']);

    expect(Array.from(result)).toEqual([0, 0, 0, 255, 0, 255, 0, 255]);
  });

  it('leaves transparent and unknown pixels untouched and does not mutate input', () => {
    const source = pixels(255, 0, 0, 0, 1, 2, 3, 255);

    const result = recolorPixels(source, ['#ff0000'], ['#ffffff']);

    expect(Array.from(result)).toEqual([255, 0, 0, 0, 1, 2, 3, 255]);
    expect(result).not.toBe(source);
  });

  it('makes removed colors transparent', () => {
    const source = pixels(255, 0, 0, 255, 0, 255, 0, 255);

    const result = recolorPixels(source, ['#ff0000', '#00ff00'], [null, '#0000ff']);

    expect(Array.from(result)).toEqual([255, 0, 0, 0, 0, 0, 255, 255]);
  });

  it('falls back to the original color when the target is missing', () => {
    const result = recolorPixels(pixels(255, 0, 0, 255), ['#ff0000'], []);

    expect(Array.from(result)).toEqual([255, 0, 0, 255]);
  });
});

/** RGBA pixels of a grid of 'w' (white), 'k' (black) and '.' (transparent), row by row. */
function grid(rows: string[]): Uint8ClampedArray {
  const colors: Record<string, number[]> = { w: [255, 255, 255, 255], k: [0, 0, 0, 255] };
  return new Uint8ClampedArray(
    rows.flatMap((row) => [...row].flatMap((cell) => colors[cell] ?? [0, 0, 0, 0])),
  );
}

/** The grid back, white pixels made transparent shown as '.'. */
function cells(pixels: Uint8ClampedArray, width: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < pixels.length / 4; i++) {
    const cell = pixels[i * 4 + 3] === 0 ? '.' : pixels[i * 4] === 255 ? 'w' : 'k';
    if (i % width === 0) out.push('');
    out[out.length - 1] += cell;
  }
  return out;
}

describe('clearBorderRegions', () => {
  it('clears the background but keeps the same color inside the motif', () => {
    const rows = ['wwwww', 'wkkkw', 'wkwkw', 'wkkkw', 'wwwww'];

    expect(cells(clearBorderRegions(grid(rows), 5, 5, '#ffffff'), 5)).toEqual([
      '.....',
      '.kkk.',
      '.kwk.',
      '.kkk.',
      '.....',
    ]);
  });

  it('does not seep in through a diagonal gap but passes transparent pixels', () => {
    const rows = ['..www', 'wwkkk', 'wkwwk', 'wkkkk'];

    expect(cells(clearBorderRegions(grid(rows), 5, 4, '#ffffff'), 5)).toEqual([
      '.....',
      '..kkk',
      '.kwwk',
      '.kkkk',
    ]);
  });
});
