// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ExportProgress } from './ExportProgress';

describe('ExportProgress', () => {
  it('says what is built, for how long, and cancels', async () => {
    const onCancel = vi.fn();
    const { rerender } = render(<ExportProgress what="the model" elapsed="" onCancel={onCancel} />);
    expect(screen.getByRole('status')).toHaveTextContent(/^Building the modelCancel$/);

    rerender(<ExportProgress what="the model" elapsed="5 s" onCancel={onCancel} />);
    expect(screen.getByRole('status')).toHaveTextContent('Building the model · 5 s');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
