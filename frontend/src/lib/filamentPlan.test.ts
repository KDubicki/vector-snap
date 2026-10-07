import { describe, expect, it } from 'vitest';
import type { FilamentPlan } from '../types/api';
import { planText, stepPosition } from './filamentPlan';

const plan: FilamentPlan = {
  steps: [
    { z_mm: 0, layer: 1, color: '#ffffff' },
    { z_mm: 1.6, layer: 9, color: '#ff0000' },
  ],
  conflicts: [{ z_mm: 2.6, colors: ['#ff0000', '#0000ff'] }],
  height_mm: 2.6,
};

describe('filament plan', () => {
  it('describes where a step starts', () => {
    expect(stepPosition(plan.steps[1])).toBe('Layer 9 · Z 1.6 mm');
    expect(stepPosition({ z_mm: 1.2000001, layer: null, color: '#000000' })).toBe('Z 1.2 mm');
  });

  it('renders the plan as text with conflicts', () => {
    expect(planText(plan)).toBe(
      [
        'Start with #ffffff',
        'Layer 9 · Z 1.6 mm: change to #ff0000',
        'Finish at 2.6 mm',
        'Warning: #ff0000, #0000ff all end at 2.6 mm and need a multi-material printer',
      ].join('\n'),
    );
  });
});
