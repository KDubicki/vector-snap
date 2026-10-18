// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { printerById } from '../lib/printers';
import { FilamentSlotsCheck } from './FilamentSlotsCheck';

const kobraX = printerById('kobra-x');

describe('FilamentSlotsCheck', () => {
  it('warns when the design needs more filaments than are loaded', async () => {
    const onReduce = vi.fn();
    render(
      <FilamentSlotsCheck
        printer={kobraX}
        needed={8}
        loaded={4}
        minColors={2}
        onReduce={onReduce}
      />,
    );

    expect(screen.getByRole('status')).toHaveTextContent(
      'The design needs 8 filaments; 4 are loaded on the Anycubic Kobra X.',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Use 4 colors' }));
    expect(onReduce).toHaveBeenCalledWith(4);
  });

  it('says nothing when the filaments fit or the printer has no slots', () => {
    const { container, rerender } = render(
      <FilamentSlotsCheck
        printer={kobraX}
        needed={4}
        loaded={4}
        minColors={2}
        onReduce={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
    rerender(
      <FilamentSlotsCheck
        printer={printerById('any')}
        needed={9}
        loaded={4}
        minColors={2}
        onReduce={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('offers no fewer colors than the palette step converts to', () => {
    render(
      <FilamentSlotsCheck
        printer={kobraX}
        needed={2}
        loaded={1}
        minColors={2}
        onReduce={vi.fn()}
      />,
    );

    expect(screen.getByRole('status')).toHaveTextContent('1 is loaded');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
