import { describe, expect, it } from 'vitest';
import { finalPalette, hexToRgb, isHexColor, rgbToHex } from './color';

describe('color helpers', () => {
  it('converts between hex and rgb', () => {
    expect(hexToRgb('#ff8000')).toEqual([255, 128, 0]);
    expect(rgbToHex([0, 15, 255])).toBe('#000fff');
  });

  it('validates hex colors', () => {
    expect(isHexColor('#A1b2C3')).toBe(true);
    expect(isHexColor('red')).toBe(false);
    expect(() => hexToRgb('#fff')).toThrow('Invalid hex color');
  });

  it('applies overrides by palette index', () => {
    const palette = [
      { index: 0, hex: '#FF0000' },
      { index: 1, hex: '#00ff00' },
    ];

    expect(finalPalette(palette, { 1: '#0000FF' })).toEqual(['#ff0000', '#0000ff']);
  });
});
