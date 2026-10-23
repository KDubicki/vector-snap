// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PrintSummary } from './PrintSummary';

const tile = (name: string) =>
  within(screen.getByRole('status', { name: 'Print summary' })).getByText(name).parentElement!;

describe('PrintSummary', () => {
  it('shows height, footprint and filament as tiles', () => {
    render(
      <PrintSummary
        heightMm={2}
        layers={10}
        baseMm={1.6}
        size={{ x_mm: 80, y_mm: 50, z_mm: 2 }}
        grams={9.94}
      />,
    );

    expect(tile('Height')).toHaveTextContent('2 mm10 layers · base 1.6 mm');
    expect(tile('Footprint')).toHaveTextContent('80.0 × 50.0 mm');
    expect(tile('Filament')).toHaveTextContent('≈ 9.9 g');
  });

  it('marks a footprint and filament not known yet', () => {
    render(<PrintSummary heightMm={2} layers={10} baseMm={1.6} size={null} grams={undefined} />);

    expect(tile('Footprint')).toHaveTextContent('—');
    expect(tile('Filament')).toHaveTextContent('—');
  });
});
