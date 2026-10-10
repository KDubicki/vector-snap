// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  COMMON_FILAMENTS,
  DEFAULT_FILAMENT_LIBRARY,
  addCustomFilament,
} from '../lib/filamentLibrary';
import { FilamentLibraryPanel } from './FilamentLibraryPanel';

describe('FilamentLibraryPanel', () => {
  it('toggles filaments and selects all or none', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <FilamentLibraryPanel library={DEFAULT_FILAMENT_LIBRARY} maxColors={6} onChange={onChange} />,
    );

    expect(screen.getByRole('status')).toHaveTextContent(
      `${COMMON_FILAMENTS.length} available · up to 6 of them are used`,
    );
    const white = screen.getByRole('button', { name: /^White/ });
    expect(white).toHaveAttribute('aria-pressed', 'true');
    await user.click(white);
    expect(onChange.mock.lastCall![0].owned).not.toContain(COMMON_FILAMENTS[0].color);
    await user.click(screen.getByRole('button', { name: 'None' }));
    expect(onChange).toHaveBeenLastCalledWith({ owned: [], custom: [] });
    await user.click(screen.getByRole('button', { name: 'All' }));
    expect(onChange.mock.lastCall![0].owned).toHaveLength(COMMON_FILAMENTS.length);
  });

  it('adds and removes own filaments', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const library = addCustomFilament(
      { owned: [], custom: [] },
      { name: 'Matte olive', color: '#556b2f' },
    );
    render(<FilamentLibraryPanel library={library} maxColors={4} onChange={onChange} />);
    expect(screen.getByRole('status')).toHaveTextContent('1 available · up to 1 of them');

    fireEvent.input(screen.getByLabelText('Your filament color'), { target: { value: '#123456' } });
    await user.type(screen.getByLabelText('Your filament name'), 'Navy silk');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    expect(onChange.mock.lastCall![0].custom).toContainEqual({
      name: 'Navy silk',
      color: '#123456',
    });
    expect(screen.getByLabelText('Your filament name')).toHaveValue('');

    await user.click(screen.getByRole('button', { name: 'Remove Matte olive' }));
    expect(onChange).toHaveBeenLastCalledWith({ owned: [], custom: [] });
  });
});
