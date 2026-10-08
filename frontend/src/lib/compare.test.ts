import { describe, expect, it } from 'vitest';
import { comparePosition } from './compare';

describe('compare divider', () => {
  it('maps the pointer to a percentage of the width', () => {
    expect(comparePosition(150, { left: 100, width: 200 })).toBe(25);
  });

  it('clamps to the image and handles an empty rect', () => {
    expect(comparePosition(0, { left: 100, width: 200 })).toBe(0);
    expect(comparePosition(500, { left: 100, width: 200 })).toBe(100);
    expect(comparePosition(10, { left: 0, width: 0 })).toBe(50);
  });
});
