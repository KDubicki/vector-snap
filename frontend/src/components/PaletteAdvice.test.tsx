// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { COMMON_FILAMENTS } from '../lib/filamentLibrary';
import type { PaletteEntry } from '../lib/paletteAdvice';
import { PaletteAdvice } from './PaletteAdvice';

const PHOTO: PaletteEntry[] = [
  { index: 0, hex: '#fafbf9', coverage: 0.53 },
  { index: 1, hex: '#050503', coverage: 0.218 },
  { index: 2, hex: '#5f8414', coverage: 0.076 },
  { index: 3, hex: '#50643b', coverage: 0.062 },
  { index: 4, hex: '#c9cf3a', coverage: 0.06 },
  { index: 5, hex: '#eab322', coverage: 0.051 },
  { index: 6, hex: '#ff00ff', coverage: 0.003 },
];

describe('PaletteAdvice', () => {
  it('offers to merge similar shades and tiny areas', async () => {
    const user = userEvent.setup();
    const onOverride = vi.fn();
    render(<PaletteAdvice entries={PHOTO} filaments={[]} onOverride={onOverride} />);

    expect(screen.getByRole('list', { name: 'Similar colors' })).toHaveTextContent(
      '#50643b6.2%≈similar to#5f84147.6%',
    );
    await user.click(screen.getByRole('button', { name: 'Merge #50643b into #5f8414' }));
    expect(onOverride).toHaveBeenLastCalledWith({ 3: '#5f8414' });

    expect(screen.getByRole('list', { name: 'Tiny colors' })).toHaveTextContent('#ff00ff0.3%');
    await user.click(screen.getByRole('button', { name: /^Merge #ff00ff into/ }));
    expect(Object.keys(onOverride.mock.lastCall![0])).toEqual(['6']);
    expect(screen.queryByRole('button', { name: 'Use my filaments' })).not.toBeInTheDocument();
  });

  it('replaces every color by the nearest filament', async () => {
    const onOverride = vi.fn();
    render(
      <PaletteAdvice
        entries={PHOTO.slice(0, 2)}
        filaments={COMMON_FILAMENTS}
        onOverride={onOverride}
      />,
    );

    expect(screen.getByText(/2 filaments: White, Black/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Use my filaments' }));
    expect(onOverride).toHaveBeenCalledWith({ 0: '#f7f7f5', 1: '#1b1b1b' });
  });

  it('has nothing to suggest for a clean palette of filaments', () => {
    const clean: PaletteEntry[] = [
      { index: 0, hex: '#f7f7f5', coverage: 0.6 },
      { index: 1, hex: '#1b1b1b', coverage: 0.4 },
    ];
    render(<PaletteAdvice entries={clean} filaments={COMMON_FILAMENTS} onOverride={vi.fn()} />);

    expect(screen.getByText(/every color earns its filament/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Use my filaments' })).not.toBeInTheDocument();
  });
});
