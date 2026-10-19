import { describe, expect, it } from 'vitest';
import { FILAMENTS, formatGrams, formatMillimetres, meshVolume, solidWeight } from './meshStats';

// Unit cube scaled to 10 mm as an indexed mesh with outward normals.
const CUBE_VERTICES = [
  0, 0, 0, 10, 0, 0, 10, 10, 0, 0, 10, 0, 0, 0, 10, 10, 0, 10, 10, 10, 10, 0, 10, 10,
];
const CUBE_FACES = [
  0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4,
  3, 4, 7,
];

describe('mesh stats', () => {
  it('computes the volume of an indexed closed mesh', () => {
    expect(meshVolume(CUBE_VERTICES, CUBE_FACES)).toBeCloseTo(1000);
  });

  it('computes the volume of a non-indexed mesh', () => {
    const flat = CUBE_FACES.flatMap((i) => CUBE_VERTICES.slice(i * 3, i * 3 + 3));

    expect(meshVolume(flat)).toBeCloseTo(1000);
  });

  it('is negative for inward-facing meshes', () => {
    const reversed = CUBE_FACES.map((_, i, all) => all[i - (i % 3) + 2 - (i % 3)]);

    expect(meshVolume(CUBE_VERTICES, reversed)).toBeCloseTo(-1000);
  });

  it('estimates solid filament weight', () => {
    expect(solidWeight(1000, 'PLA')).toBeCloseTo(FILAMENTS.PLA); // 1 cm³
    expect(solidWeight(25_000, 'ABS')).toBeCloseTo(26);
  });

  it('formats millimetres', () => {
    expect(formatMillimetres(12.345)).toBe('12.3');
    expect(formatMillimetres(150.4)).toBe('150');
  });

  it('formats grams with one decimal below 10 g and traces as < 0.1', () => {
    expect([0.04, 0.34, 9.96, 12.3].map(formatGrams)).toEqual(['< 0.1', '≈ 0.3', '≈ 10', '≈ 12']);
  });
});
