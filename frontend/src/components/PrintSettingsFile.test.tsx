// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { download } from '../lib/download';
import { DEFAULT_PRINT } from '../lib/printPlan';
import { presetJson } from '../lib/printPreset';
import { PrintSettingsFile } from './PrintSettingsFile';

vi.mock('../lib/download', () => ({ download: vi.fn() }));

describe('PrintSettingsFile', () => {
  beforeEach(() => vi.mocked(download).mockReset());

  it('saves the settings as a JSON file named after the image', async () => {
    render(<PrintSettingsFile settings={DEFAULT_PRINT} fileName="logo.png" onLoad={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: 'Save print settings' }));
    const [blob, name] = vi.mocked(download).mock.calls[0];
    expect(name).toBe('logo.print.json');
    expect(JSON.parse(await blob.text()).settings.widthMm).toBe(80);
  });

  it('loads settings from a file and reports a file that is not one', async () => {
    const onLoad = vi.fn();
    render(<PrintSettingsFile settings={DEFAULT_PRINT} fileName={undefined} onLoad={onLoad} />);
    const input = screen.getByLabelText('Print settings file');

    const good = presetJson({ ...DEFAULT_PRINT, widthMm: 120 });
    fireEvent.change(input, { target: { files: [new File([good], 'sign.print.json')] } });
    await waitFor(() =>
      expect(onLoad).toHaveBeenCalledWith(
        expect.objectContaining({ widthMm: 120 }),
        'sign.print.json',
      ),
    );
    expect(screen.getByRole('status')).toHaveTextContent(
      'Loaded the print settings of sign.print.json.',
    );

    fireEvent.change(input, { target: { files: [new File(['{}'], 'other.json')] } });
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Not a VectorSnap print settings file.',
    );
    expect(onLoad).toHaveBeenCalledTimes(1);
  });
});
