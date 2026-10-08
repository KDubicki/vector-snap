import { describe, expect, it } from 'vitest';
import { finalPalette, hexToRgb, isHexColor, relativeLuminance, rgbToHex } from './color';

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

  it('computes the relative luminance like the backend', () => {
    expect(relativeLuminance('#000000')).toBe(0);
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1);
    expect(relativeLuminance('#00ff00')).toBeGreaterThan(relativeLuminance('#ff0000'));
  });
});
