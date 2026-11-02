// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../state/store';
import { sampleDoc } from '../test/fixtures';
import { SimplifyOutlines } from './SimplifyOutlines';

const store = () => useAppStore.getState();

describe('SimplifyOutlines', () => {
  beforeEach(() => {
    store().reset();
    useAppStore.setState({ editor: sampleDoc() });
  });

  it('simplifies at the chosen level, the selection or every shape', async () => {
    const simplifyOutlines = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({ simplifyOutlines });
    const { rerender } = render(<SimplifyOutlines />);

    await userEvent.click(screen.getByRole('radio', { name: 'Strong' }));
    await userEvent.click(screen.getByRole('button', { name: 'Simplify every shape' }));
    expect(simplifyOutlines).toHaveBeenCalledWith(2);

    store().selectMany(['p-1-0', 'p-1-1']);
    rerender(<SimplifyOutlines />);
    expect(screen.getByRole('button', { name: 'Simplify 2 selected shapes' })).toBeEnabled();

    useAppStore.setState({ simplifying: true });
    rerender(<SimplifyOutlines />);
    expect(screen.getByRole('button', { name: 'Simplifying…' })).toBeDisabled();
  });
});
