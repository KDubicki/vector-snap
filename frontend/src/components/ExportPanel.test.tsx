// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { exportFile, exportLithophane, getFilamentPlan } from '../api/client';
import { download } from '../lib/download';
import { svgToPng } from '../lib/raster';
import { useAppStore } from '../state/store';
import { sampleDoc } from '../test/fixtures';
import { ExportPanel } from './ExportPanel';

vi.mock('../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/client')>()),
  exportFile: vi.fn(),
  exportLithophane: vi.fn(),
  getFilamentPlan: vi.fn(),
}));
vi.mock('../lib/raster', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/raster')>()),
  svgToPng: vi.fn(),
}));
vi.mock('../lib/download', () => ({ download: vi.fn() }));
// three.js needs WebGL; the preview only has to receive the right request.
vi.mock('./ModelPreview', () => ({
  default: ({ request, onCancel }: { request: { kind: string }; onCancel: () => void }) => (
    <div role="region" aria-label="3D preview">
      {request.kind}
      <button type="button" onClick={onCancel}>
        Close preview
      </button>
    </div>
  ),
}));

const store = () => useAppStore.getState();
const user = () => userEvent.setup();

async function renderPanel() {
  render(<ExportPanel />);
  await userEvent.click(screen.getByText('Export to other formats'));
}

describe('ExportPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store().reset();
    useAppStore.setState({
      editor: sampleDoc(),
      file: new File(['png'], 'logo.png', { type: 'image/png' }),
    });
  });

  it('exports an STL with per-color heights', async () => {
    const u = user();
    vi.mocked(exportFile).mockResolvedValue(new Blob(['stl']));
    await renderPanel();

    await u.click(screen.getByLabelText('Include #ffffff'));
    fireEvent.change(screen.getByLabelText('#ff0000'), { target: { value: '3' } });
    await u.click(screen.getByRole('button', { name: 'Export STL' }));

    await waitFor(() => expect(download).toHaveBeenCalledWith(expect.any(Blob), 'logo.stl'));
    const [format, , options] = vi.mocked(exportFile).mock.calls[0];
    expect(format).toBe('stl');
    expect(JSON.parse(String(options.layer_heights))).toEqual({ '0': 0, '1': 3 });
  });

  it('names the 3MF model after the image', async () => {
    const u = user();
    vi.mocked(exportFile).mockResolvedValue(new Blob(['3mf']));
    await renderPanel();

    await u.click(screen.getByRole('radio', { name: '3MF' }));
    await u.click(screen.getByRole('button', { name: 'Export 3MF' }));

    await waitFor(() => expect(download).toHaveBeenCalledWith(expect.any(Blob), 'logo.3mf'));
    expect(vi.mocked(exportFile).mock.calls[0][2]).toMatchObject({ title: 'logo' });
  });

  it('starts with a flat model and resets raised colors to flat', async () => {
    const u = user();
    vi.mocked(exportFile).mockResolvedValue(new Blob(['stl']));
    await renderPanel();

    expect(screen.getByLabelText(/Stack colors at increasing heights/)).not.toBeChecked();
    expect(screen.getByLabelText('#ff0000')).toHaveAttribute('placeholder', 'auto 1');
    expect(screen.getByText(/the model is flat/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reset heights' })).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('#ff0000'), { target: { value: '3' } });
    await u.click(screen.getByRole('button', { name: 'Reset heights' }));
    expect(screen.getByLabelText('#ff0000')).toHaveValue(null);
    await u.click(screen.getByRole('button', { name: 'Export STL' }));

    await waitFor(() => expect(exportFile).toHaveBeenCalled());
    const [, , options] = vi.mocked(exportFile).mock.calls[0];
    expect(options.layered).toBe(false);
    expect(JSON.parse(String(options.layer_heights))).toEqual({});
  });

  it('summarizes collapsed sections and blocks invalid exports', async () => {
    const u = user();
    await renderPanel();
    const extras = screen.getByText('Base plate extras').closest('details')!;

    await u.click(within(extras).getByText('Base plate extras'));
    fireEvent.change(screen.getByLabelText('Base plate margin (mm)'), { target: { value: '5' } });
    expect(within(extras).getByText('1 changed')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Base plate margin (mm)'), { target: { value: '-1' } });
    expect(within(extras).getByText('1 to fix')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export STL' })).toBeDisabled();
  });

  it('plans filament changes and reports planning errors', async () => {
    const u = user();
    vi.mocked(getFilamentPlan)
      .mockResolvedValueOnce({
        steps: [{ z_mm: 0, layer: null, color: '#ffffff' }],
        conflicts: [],
        height_mm: 2,
      })
      .mockRejectedValueOnce(new Error('No backend'));
    await renderPanel();

    await u.click(screen.getByRole('button', { name: 'Plan filament changes' }));
    expect(await screen.findByRole('region', { name: 'Filament changes' })).toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: 'Update filament changes' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No backend');
  });

  it('previews the colored model, and the lithophane from the original image', async () => {
    const u = user();
    vi.mocked(exportLithophane).mockResolvedValue(new Blob(['stl']));
    await renderPanel();

    await u.click(screen.getByRole('button', { name: 'Preview 3D' }));
    expect(await screen.findByRole('region', { name: '3D preview' })).toHaveTextContent('3mf');
    await u.click(screen.getByRole('button', { name: 'Close preview' }));

    await u.click(screen.getByRole('radio', { name: 'Lithophane' }));
    await u.click(screen.getByRole('button', { name: 'Preview 3D' }));
    expect(await screen.findByRole('region', { name: '3D preview' })).toHaveTextContent('stl');
    await u.click(screen.getByRole('button', { name: 'Export Lithophane' }));
    await waitFor(() =>
      expect(download).toHaveBeenCalledWith(expect.any(Blob), 'logo.lithophane.stl'),
    );
    expect(vi.mocked(exportLithophane).mock.calls[0][0]).toBe(store().file);

    // Another kind of model drops the shown preview.
    await u.click(screen.getByRole('radio', { name: 'STL' }));
    expect(screen.queryByRole('region', { name: '3D preview' })).not.toBeInTheDocument();
  });

  it('renders PNG in the browser at the chosen size', async () => {
    const u = user();
    vi.mocked(svgToPng).mockResolvedValue(new Blob(['png']));
    await renderPanel();

    await u.click(screen.getByRole('radio', { name: 'PNG' }));
    expect(screen.getByRole('status')).toHaveTextContent('Output: 2048 × 1024 px');
    fireEvent.change(screen.getByLabelText('Background'), { target: { value: 'white' } });
    await u.click(screen.getByRole('button', { name: 'Export PNG' }));

    await waitFor(() => expect(download).toHaveBeenCalledWith(expect.any(Blob), 'logo.png'));
    expect(vi.mocked(svgToPng).mock.calls[0].slice(1)).toEqual([
      { width: 2048, height: 1024, limited: false },
      '#ffffff',
    ]);
    expect(exportFile).not.toHaveBeenCalled();
  });

  it('exports vector formats without color heights', async () => {
    const u = user();
    vi.mocked(exportFile).mockResolvedValue(new Blob(['dxf']));
    await renderPanel();

    await u.click(screen.getByRole('radio', { name: 'DXF' }));
    expect(screen.queryByText(/Height per color/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Preview 3D' })).not.toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: 'Export DXF' }));
    await waitFor(() => expect(download).toHaveBeenCalledWith(expect.any(Blob), 'logo.dxf'));
  });

  it('exports EPS with its width and margin', async () => {
    const u = user();
    vi.mocked(exportFile).mockResolvedValue(new Blob(['%!PS']));
    await renderPanel();

    await u.click(screen.getByRole('radio', { name: 'EPS' }));
    await u.click(screen.getByRole('button', { name: 'Export EPS' }));

    await waitFor(() => expect(download).toHaveBeenCalledWith(expect.any(Blob), 'logo.eps'));
    expect(vi.mocked(exportFile).mock.calls[0][0]).toBe('eps');
    expect(vi.mocked(exportFile).mock.calls[0][2]).toEqual({ width_mm: 100, margin_mm: 0 });
  });
});
