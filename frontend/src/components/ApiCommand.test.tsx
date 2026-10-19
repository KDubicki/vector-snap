// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiCommand } from './ApiCommand';

describe('ApiCommand', () => {
  afterEach(() => vi.restoreAllMocks());

  it('shows the 3MF export as a command and copies it', async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
    render(<ApiCommand options={{ width_mm: 80 }} fileName="logo.png" />);

    await user.click(screen.getByText('API command (curl)'));
    const command = document.querySelector('pre')!.textContent!;
    expect(command).toContain('-F svg=@logo.svg');
    expect(command).toContain('/api/v1/export/3mf -o logo.3mf');
    await user.click(screen.getByRole('button', { name: 'Copy command' }));
    expect(writeText).toHaveBeenCalledWith(command);
    expect(screen.getByRole('status')).toHaveTextContent('Copied.');
  });

  it('says so when copying is blocked', async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'));
    render(<ApiCommand options={{}} fileName={undefined} />);

    await user.click(screen.getByRole('button', { name: 'Copy command' }));
    expect(screen.getByRole('status')).toHaveTextContent('select the command above');
  });
});
