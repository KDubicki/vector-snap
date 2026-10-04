// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { cutRegion, pathArea, splitShape } from './geometry';

const SQUARE = 'M0,0 L10,0 L10,10 L0,10 Z';
// 20x20 square with a 10x10 hole in the middle
const FRAME = 'M0,0 L20,0 L20,20 L0,20 Z M5,5 L5,15 L15,15 L15,5 Z';
// U shape: two arms connected at the bottom
const U_SHAPE = 'M0,0 L4,0 L4,6 L6,6 L6,0 L10,0 L10,10 L0,10 Z';

const line = (...coords: [number, number][]) => coords.map(([x, y]) => ({ x, y }));
const areas = (parts: string[] | null) =>
  (parts ?? []).map((d) => Math.round(pathArea(d) * 10) / 10).sort((a, b) => a - b);

describe('splitShape', () => {
  it('splits a square along a straight line', () => {
    const parts = splitShape(SQUARE, line([5, -5], [5, 15]));

    expect(parts).toHaveLength(2);
    expect(areas(parts)).toEqual([50, 50]);
  });

  it('follows a polyline cut', () => {
    const parts = splitShape(SQUARE, line([-1, 2], [5, 2], [5, 8], [11, 8]));

    expect(areas(parts)).toEqual([50, 50]);
  });

  it('keeps holes with their pieces', () => {
    const parts = splitShape(FRAME, line([-1, 2], [21, 2]));

    // a 20x2 strip on top and the rest of the frame (with its hole) below
    expect(areas(parts)).toEqual([40, 260]);
  });

  it('separates disjoint pieces into independent shapes', () => {
    const parts = splitShape(U_SHAPE, line([-1, 3], [11, 3]));

    // the cut crosses both arms: two arm tips and the remaining U
    expect(parts).toHaveLength(3);
    expect(areas(parts)).toEqual([12, 12, 64]);
  });

  it('cuts a frame through its hole into two pieces', () => {
    const parts = splitShape(FRAME, line([10, -1], [10, 21]));

    expect(areas(parts)).toEqual([150, 150]);
  });

  it('rejects lines that do not fully cross the shape', () => {
    expect(splitShape(SQUARE, line([5, 5], [5, 15]))).toBeNull(); // starts inside
    expect(splitShape(SQUARE, line([5, -5], [5, 5]))).toBeNull(); // ends inside
    expect(splitShape(SQUARE, line([20, -5], [20, 15]))).toBeNull(); // misses
    expect(splitShape(SQUARE, line([5, -5]))).toBeNull(); // not a line
  });

  it('rejects cuts that only graze an edge', () => {
    expect(splitShape(SQUARE, line([0, -5], [0, 15]))).toBeNull();
  });
});

describe('cutRegion', () => {
  const box = (x0: number, y0: number, x1: number, y1: number) =>
    line([x0, y0], [x1, y0], [x1, y1], [x0, y1]);

  it('cuts the part of a shape inside the region', () => {
    const cut = cutRegion(SQUARE, box(-5, -5, 4, 15));

    expect(areas(cut?.inside ?? null)).toEqual([40]);
    expect(areas(cut?.outside ?? null)).toEqual([60]);
  });

  it('can cut a hole into a shape', () => {
    const cut = cutRegion(SQUARE, box(3, 3, 7, 7));

    expect(areas(cut?.inside ?? null)).toEqual([16]);
    expect(areas(cut?.outside ?? null)).toEqual([84]);
  });

  it('separates disjoint pieces inside the region', () => {
    const cut = cutRegion(U_SHAPE, box(-1, -1, 11, 3));

    expect(areas(cut?.inside ?? null)).toEqual([12, 12]);
    expect(areas(cut?.outside ?? null)).toEqual([64]);
  });

  it('returns null when the region does not split the shape', () => {
    expect(cutRegion(SQUARE, box(20, 20, 30, 30))).toBeNull(); // no overlap
    expect(cutRegion(SQUARE, box(-1, -1, 11, 11))).toBeNull(); // covers it fully
    expect(cutRegion(SQUARE, line([1, 1], [2, 2]))).toBeNull(); // not a region
    expect(cutRegion(SQUARE, line([1, 1], [5, 1], [9, 1]))).toBeNull(); // no area
  });
});
