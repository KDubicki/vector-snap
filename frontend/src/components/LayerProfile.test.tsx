// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PRINT, heightPlan, type PrintSettings } from '../lib/printPlan';
import { sampleDoc } from '../test/fixtures';
import { LayerProfile } from './LayerProfile';

const renderProfile = (change: Partial<PrintSettings>) => {
  const settings = { ...DEFAULT_PRINT, ...change };
  const doc = sampleDoc();
  const { colors, totalLayers } = heightPlan(doc, settings);
  return render(
    <LayerProfile doc={doc} settings={settings} colors={colors} totalLayers={totalLayers} />,
  );
};
const rect = (fill: string) => document.querySelector(`rect[fill="${fill}"]`)!;

describe('LayerProfile', () => {
  it('stands each color on the base plate at its height', () => {
    // 8 base layers, white 2 layers, red stepped on top: 4 layers.
    renderProfile({ style: 'stepped', baseLayers: 8, colorLayers: 2 });

    expect(screen.getByRole('img')).toHaveAccessibleName(
      'Side view: base 1.6 mm, then #ffffff 0.4 mm, #ff0000 0.8 mm',
    );
    expect(screen.getByText(/Side view · 2.4 mm/)).toBeInTheDocument();
    // 64 units for 12 layers: the base is 42.67 high, white stands on it.
    expect(Number(rect('#ffffff').getAttribute('height'))).toBeCloseTo(10.67);
    expect(Number(rect('#ffffff').getAttribute('y'))).toBeCloseTo(10.67);
    expect(Number(rect('#ff0000').getAttribute('y'))).toBeCloseTo(0);
  });

  it('sinks inlaid colors into the plate from the top', () => {
    renderProfile({ inlay: true, baseLayers: 8, colorLayers: 2 });

    expect(rect('#ffffff').getAttribute('y')).toBe('0');
    expect(rect('#ff0000').getAttribute('y')).toBe('0');
  });

  it('shows nothing for a cut-out print', () => {
    const { container } = renderProfile({ style: 'cutout' });

    expect(container).toBeEmptyDOMElement();
  });
});
