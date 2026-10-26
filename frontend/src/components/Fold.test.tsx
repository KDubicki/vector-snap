// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PRINT } from '../lib/printPlan';
import { BasePlateFields } from './BasePlateFields';
import { Fold } from './Fold';
import { OutlineFields } from './OutlineFields';

const details = (title: string) => screen.getByText(title).closest('details')!;

describe('Fold', () => {
  it('starts folded, says what is inside and opens on a click', () => {
    render(
      <Fold title="Base plate" values="Circle · mirrored">
        <input aria-label="Inside" />
      </Fold>,
    );

    expect(details('Base plate')).not.toHaveAttribute('open');
    expect(screen.getByText('Circle · mirrored')).toBeInTheDocument();
    details('Base plate').open = true;
    fireEvent(details('Base plate'), new Event('toggle'));
    expect(details('Base plate')).toHaveAttribute('open');
  });

  it('opens by itself while an option has an error, and stays open after', () => {
    const { rerender } = render(
      <Fold title="Base plate" values="" invalid>
        <input aria-label="Inside" />
      </Fold>,
    );
    expect(details('Base plate')).toHaveAttribute('open');
    fireEvent(details('Base plate'), new Event('toggle'));

    rerender(
      <Fold title="Base plate" values="">
        <input aria-label="Inside" />
      </Fold>,
    );
    expect(details('Base plate')).toHaveAttribute('open');
  });

  it('sums up the base plate and the outlines', () => {
    const print = {
      ...DEFAULT_PRINT,
      baseShape: 'circle' as const,
      marginMm: 3,
      loopHoleMm: 4,
      magnetMm: 10.2,
      magnetCount: 2,
      screwHoles: 4,
      inlay: true,
      mirror: true,
      outlineMm: 0.8,
      outlineColor: '#000000',
      outlineRaised: true,
    };
    render(<BasePlateFields settings={print} errors={{}} onChange={() => undefined} />);
    render(<OutlineFields settings={print} errors={{}} onChange={() => undefined} />);

    expect(details('Base plate')).toHaveTextContent(
      'Circle · 3 mm border · loop 4 mm · 2 magnets 10.2 mm · 4 screw holes · flat top · mirrored',
    );
    expect(details('Outlines')).toHaveTextContent('0.8 mm in #000000, raised');
  });

  it('opens the base plate on its errors and says when there are no outlines', () => {
    render(
      <BasePlateFields
        settings={DEFAULT_PRINT}
        errors={{ rimMm: 'Too wide.' }}
        onChange={() => undefined}
      />,
    );
    render(<OutlineFields settings={DEFAULT_PRINT} errors={{}} onChange={() => undefined} />);

    expect(details('Base plate')).toHaveAttribute('open');
    expect(details('Base plate')).toHaveTextContent('Follow the design');
    expect(details('Outlines')).not.toHaveAttribute('open');
    expect(details('Outlines')).toHaveTextContent('None');
  });
});
