// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { printerById } from '../lib/printers';
import { ColorChangesSummary } from './ColorChangesSummary';

const kobraX = printerById('kobra-x');
const changes = {
  layers: 24,
  changes: 57,
  max_colors_per_layer: 8,
  change_time_s: 3021,
  purge_mm3: 12882,
  purge_g: 15.97,
};

describe('ColorChangesSummary', () => {
  it('sums up the filament changes, their time and purge', () => {
    render(<ColorChangesSummary printer={kobraX} changes={changes} />);

    expect(screen.getByRole('status')).toHaveTextContent(
      '≈ 57 filament changes on the Anycubic Kobra X: about 50 min and 15.97 g of purged filament (up to 8 colors per layer).',
    );
  });

  it('says when no change is needed, and nothing while unknown', () => {
    const { container, rerender } = render(
      <ColorChangesSummary printer={kobraX} changes={{ ...changes, changes: 0 }} />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('No filament changes');

    rerender(<ColorChangesSummary printer={kobraX} changes={null} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<ColorChangesSummary printer={printerById('any')} changes={changes} />);
    expect(container).toBeEmptyDOMElement();
  });
});
