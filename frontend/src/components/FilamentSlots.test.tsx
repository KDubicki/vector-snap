// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { Filament } from '../lib/mixing';
import { FilamentSlots } from './FilamentSlots';

const TWO: Filament[] = [
  { color: '#ffffff', td: 3 },
  { color: '#ff0000', td: 1.5 },
];

function renderSlots(filaments = TWO, error?: string) {
  const onChange = vi.fn();
  const onSuggest = vi.fn();
  render(
    <FilamentSlots filaments={filaments} error={error} onChange={onChange} onSuggest={onSuggest} />,
  );
  return { onChange, onSuggest };
}

describe('FilamentSlots', () => {
  it('lists the filaments with their color and TD', () => {
    renderSlots();

    expect(screen.getByText('#ff0000')).toBeInTheDocument();
    expect(screen.getByLabelText('Filament 1 transmission distance (mm)')).toHaveValue(3);
    expect(screen.getByLabelText('Filament 2 color')).toHaveValue('#ff0000');
  });

  it('edits the color and the TD of one slot', () => {
    const { onChange } = renderSlots();

    fireEvent.change(screen.getByLabelText('Filament 2 color'), { target: { value: '#00FF00' } });
    expect(onChange).toHaveBeenLastCalledWith([TWO[0], { color: '#00ff00', td: 1.5 }]);

    fireEvent.change(screen.getByLabelText('Filament 1 transmission distance (mm)'), {
      target: { value: '2.5' },
    });
    expect(onChange).toHaveBeenLastCalledWith([{ color: '#ffffff', td: 2.5 }, TWO[1]]);
  });

  it('adds and removes filaments within the slot limit', async () => {
    const user = userEvent.setup();
    const { onChange, onSuggest } = renderSlots();

    await user.click(screen.getByRole('button', { name: 'Add filament' }));
    expect(onChange).toHaveBeenLastCalledWith([...TWO, { color: '#808080', td: 1.5 }]);
    await user.click(screen.getByRole('button', { name: 'Remove filament 1' }));
    expect(onChange).toHaveBeenLastCalledWith([TWO[1]]);
    await user.click(screen.getByRole('button', { name: 'Suggest from the design' }));
    expect(onSuggest).toHaveBeenCalled();
  });

  it('keeps at least one filament', () => {
    renderSlots([TWO[0]]);
    expect(screen.getByRole('button', { name: 'Remove filament 1' })).toBeDisabled();
  });

  it('disables adding when all slots are used and shows errors', () => {
    renderSlots([TWO[0], TWO[1], TWO[0], TWO[1]], 'Every filament needs a color.');

    expect(screen.getByRole('button', { name: 'Add filament' })).toBeDisabled();
    expect(screen.getByText('Every filament needs a color.')).toBeInTheDocument();
  });
});
