import { describe, expect, it } from 'vitest';
import { recolorPixels } from './recolor';

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

  it('falls back to the original color when the target is missing', () => {
    const result = recolorPixels(pixels(255, 0, 0, 255), ['#ff0000'], []);

    expect(Array.from(result)).toEqual([255, 0, 0, 255]);
  });
});
