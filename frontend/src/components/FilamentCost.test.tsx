// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FilamentCost } from './FilamentCost';

describe('FilamentCost', () => {
  it('prices the print, purge included, and remembers the price', () => {
    const { unmount } = render(<FilamentCost modelGrams={9.2} purgeGrams={0.8} />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Filament price per kg'), { target: { value: '80' } });
    expect(screen.getByRole('status')).toHaveTextContent('≈ 0.80 for this print, purge included');
    unmount();

    render(<FilamentCost modelGrams={10} purgeGrams={0} />);
    expect(screen.getByLabelText('Filament price per kg')).toHaveValue(80);
    expect(screen.getByRole('status')).toHaveTextContent('≈ 0.80 for this print');
    expect(screen.getByRole('status')).not.toHaveTextContent('purge');
  });

  it('shows no cost without a valid price or a known weight', () => {
    render(<FilamentCost modelGrams={undefined} purgeGrams={0} />);
    fireEvent.change(screen.getByLabelText('Filament price per kg'), { target: { value: '80' } });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('forgets an invalid price', () => {
    render(<FilamentCost modelGrams={10} purgeGrams={0} />);
    fireEvent.change(screen.getByLabelText('Filament price per kg'), { target: { value: '-5' } });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(localStorage.getItem('vectorsnap.filament-price')).toBeNull();
  });
});
