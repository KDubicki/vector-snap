// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MergedColors } from './MergedColors';

describe('MergedColors', () => {
  it('lists every merged color, the color it joined and why', () => {
    render(
      <MergedColors
        merged={[
          { hex: '#fefefe', into: '#ffffff', coverage: 0.3, reason: 'similar', delta_e: 0.31 },
          { hex: '#5a5a5a', into: '#000000', coverage: 0.012, reason: 'small', delta_e: 24.6 },
        ]}
      />,
    );

    const status = screen.getByRole('status', { name: 'Merged colors' });
    expect(status).toHaveTextContent('2 colors merged into another:');
    const [similar, small] = screen.getAllByRole('listitem');
    expect(similar).toHaveTextContent(/^#fefefe→#fffffflooks the same, ΔE 0\.3$/);
    expect(small).toHaveTextContent(/^#5a5a5a→#000000only 1\.2% of the image$/);
  });

  it('shows nothing when no color was merged', () => {
    const { container } = render(<MergedColors merged={[]} />);

    expect(container).toBeEmptyDOMElement();
  });
});
