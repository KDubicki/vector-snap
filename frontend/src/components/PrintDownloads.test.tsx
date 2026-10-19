// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PrintDownloads } from './PrintDownloads';

const props = {
  invalid: false,
  exporting: false,
  elapsed: '',
  error: null,
  mixedFilaments: null,
  onDownload: vi.fn(),
  onCancel: vi.fn(),
};

describe('PrintDownloads', () => {
  it('downloads each format', async () => {
    const onDownload = vi.fn();
    render(<PrintDownloads {...props} onDownload={onDownload} />);

    for (const [name, format] of [
      ['Download 3MF', '3mf'],
      ['Download STL', 'stl'],
      ['STL per color (ZIP)', 'stl-parts'],
    ]) {
      await userEvent.click(screen.getByRole('button', { name }));
      expect(onDownload).toHaveBeenLastCalledWith(format);
    }
    expect(screen.getByText(/assigns AMS slots automatically/)).toBeInTheDocument();
  });

  it('blocks downloads while exporting or invalid and shows progress and errors', () => {
    const { rerender } = render(<PrintDownloads {...props} invalid />);
    expect(screen.getByRole('button', { name: 'Download 3MF' })).toBeDisabled();

    rerender(<PrintDownloads {...props} exporting error="No backend" mixedFilaments={3} />);
    expect(screen.getByRole('button', { name: 'STL per color (ZIP)' })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('No backend');
    expect(screen.getByText(/only in the 3 filament colors/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Cancel/ })).toBeInTheDocument();
  });
});
