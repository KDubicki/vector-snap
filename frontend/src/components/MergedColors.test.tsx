// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MergedColors } from './MergedColors';

describe('MergedColors', () => {
  it('lists every merged color with its share and the color it joined', () => {
    render(
      <MergedColors
        merged={[
          { hex: '#5a5a5a', into: '#000000', coverage: 0.012 },
          { hex: '#f8e5e5', into: '#ffffff', coverage: 0.004 },
        ]}
        minCoverage={2}
      />,
    );

    const status = screen.getByRole('status', { name: 'Merged colors' });
    expect(status).toHaveTextContent('2 colors under 2% of the image joined the nearest color:');
    expect(status).toHaveTextContent('#5a5a5a (1.2%) →#000000');
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('shows nothing when no color was merged', () => {
    const { container } = render(<MergedColors merged={[]} minCoverage={2} />);

    expect(container).toBeEmptyDOMElement();
  });
});
