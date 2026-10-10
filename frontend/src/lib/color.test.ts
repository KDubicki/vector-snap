import { describe, expect, it } from 'vitest';
import {
  deltaE,
  deltaE2000,
  finalPalette,
  hexToRgb,
  isHexColor,
  labDeltaE2000,
  nearestColor,
  relativeLuminance,
  rgbToHex,
  toLab,
  type Lab,
} from './color';

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

describe('nearestColor', () => {
  it('picks the closest candidate, or keeps the color without candidates', () => {
    expect(nearestColor('#f01010', ['#000000', '#ff0000', '#ffffff'])).toBe('#ff0000');
    expect(nearestColor('#202020', ['#000000', '#ffffff'])).toBe('#000000');
    expect(nearestColor('#123456', [])).toBe('#123456');
  });
});

describe('color differences', () => {
  it('converts to Lab and measures CIE76 differences', () => {
    expect(toLab('#ffffff')[0]).toBeCloseTo(100, 1);
    expect(toLab('#000000')[0]).toBeCloseTo(0, 1);
    expect(deltaE('#ff0000', '#ff0000')).toBe(0);
    expect(deltaE('#000000', '#ffffff')).toBeCloseTo(100, 0);
  });

  it.each([
    // Sharma, Wu & Dalal (2005), test data pairs 1, 7, 17, 25 and 34.
    [[50, 2.6772, -79.7751], [50, 0, -82.7485], 2.0425],
    [[50, 0, 0], [50, -1, 2], 2.3669],
    [[50, 2.5, 0], [73, 25, -18], 27.1492],
    [[60.2574, -34.0099, 36.2677], [60.4626, -34.1751, 39.4387], 1.2644],
    [[90.8027, -2.0831, 1.441], [91.1528, -1.6435, 0.0447], 1.4441],
  ] as [Lab, Lab, number][])('matches the CIEDE2000 reference data %#', (a, b, expected) => {
    expect(labDeltaE2000(a, b)).toBeCloseTo(expected, 4);
    expect(labDeltaE2000(b, a)).toBeCloseTo(expected, 4);
  });

  it('measures perceived differences of hex colors', () => {
    expect(deltaE2000('#123456', '#123456')).toBe(0);
    expect(deltaE2000('#5f8414', '#50643b')).toBeCloseTo(deltaE2000('#50643b', '#5f8414'), 10);
    expect(deltaE2000('#000000', '#ffffff')).toBeCloseTo(100, 0);
    // Saturated colors: CIE76 exaggerates their differences, CIEDE2000 does not.
    expect(deltaE2000('#ff0000', '#ee0000')).toBeLessThan(deltaE('#ff0000', '#ee0000'));
  });
});
