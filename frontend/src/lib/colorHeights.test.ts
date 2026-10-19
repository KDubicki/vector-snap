import { describe, expect, it } from 'vitest';
import {
  snapToLayers,
  stackPositions,
  autoLayerHeight,
  layerHeightsJson,
  hasCustomHeights,
  validateColorHeights,
} from './colorHeights';

describe('per-color heights', () => {
  it('computes automatic heights like the backend', () => {
    expect(autoLayerHeight(2, { layer_mm: 0.5, layered: true })).toBe(1.5);
    expect(autoLayerHeight(2, { layer_mm: 0.5, layered: false })).toBe(0.5);
    expect(autoLayerHeight(2, { layer_mm: 0.5, layered: true, print_layer_mm: 0.2 })).toBe(1.6);
  });

  it('orders colors by brightness like the backend', () => {
    const fills = ['#808080', '#ffffff', '#000000', '#808080'];

    expect(stackPositions(fills, 'document')).toEqual([0, 1, 2, 3]);
    expect(stackPositions(fills, 'light_to_dark')).toEqual([1, 0, 3, 2]);
    expect(stackPositions(fills, 'dark_to_light')).toEqual([1, 3, 0, 2]);
  });

  it('sends only excluded colors and explicit heights', () => {
    const json = layerHeightsJson([
      { paletteIndex: 0, included: false, height: null },
      { paletteIndex: 1, included: true, height: null },
      { paletteIndex: 3, included: true, height: 2.5 },
      { paletteIndex: 4, included: false, height: 7 },
    ]);

    expect(JSON.parse(json)).toEqual({ '0': 0, '3': 2.5, '4': 0 });
  });

  it('validates the selection and the height range', () => {
    expect(validateColorHeights([])).toBeNull();
    expect(validateColorHeights([{ paletteIndex: 0, included: false, height: null }])).toBe(
      'Include at least one color.',
    );
    expect(validateColorHeights([{ paletteIndex: 0, included: true, height: 0 }])).toMatch(
      'greater than 0',
    );
    expect(validateColorHeights([{ paletteIndex: 0, included: true, height: 2 }])).toBeNull();
  });

  it('tells whether any color has a height of its own', () => {
    expect(hasCustomHeights([{ paletteIndex: 0, included: false, height: null }])).toBe(false);
    expect(hasCustomHeights([{ paletteIndex: 0, included: true, height: 2 }])).toBe(true);
  });

  it('snaps heights to whole printer layers like the backend', () => {
    expect(snapToLayers(1, 0)).toBe(1);
    expect(snapToLayers(0, 0.2)).toBe(0);
    expect(snapToLayers(0.3, 0.2)).toBe(0.4);
    expect(snapToLayers(0.05, 0.2)).toBe(0.2);
    expect(snapToLayers(1, 0.12)).toBe(0.96);
  });
});
