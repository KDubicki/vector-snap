// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { PrintCheck } from '../types/api';
import { ThinShapesCheck } from './ThinShapesCheck';

const shape = (id: string, vanishes: boolean) => ({
  id,
  palette_index: 1,
  color: '#ff0000',
  area_mm2: 2,
  thin_mm2: vanishes ? 2 : 1.5,
  vanishes,
});
const check = (shapes: PrintCheck['shapes']): PrintCheck => ({
  nozzle_mm: 0.4,
  shapes,
  thin_mm2: 3.5,
});

describe('ThinShapesCheck', () => {
  it('shows nothing while unknown or when every shape prints', () => {
    const { container, rerender } = render(<ThinShapesCheck check={null} onSelect={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();

    rerender(<ThinShapesCheck check={check([])} onSelect={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('counts the thin shapes, those that vanish, and selects them', async () => {
    const onSelect = vi.fn();
    render(
      <ThinShapesCheck
        check={check([shape('p-1-0', true), shape('p-1-1', false)])}
        onSelect={onSelect}
      />,
    );

    expect(screen.getByRole('status')).toHaveTextContent(
      '2 shapes are narrower than the 0.4 mm nozzle and will print only in part (1 not at all).',
    );
    await userEvent.setup().click(screen.getByRole('button', { name: 'Show them in the design' }));
    expect(onSelect).toHaveBeenCalledWith(['p-1-0', 'p-1-1']);
  });

  it('says a single vanishing shape will not print', () => {
    render(<ThinShapesCheck check={check([shape('p-1-0', true)])} onSelect={vi.fn()} />);

    expect(screen.getByRole('status')).toHaveTextContent(
      '1 shape is narrower than the 0.4 mm nozzle and will not print.',
    );
  });
});
