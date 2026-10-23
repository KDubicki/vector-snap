// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { exportFile, getColorChanges, getFilamentPlan, getModelSize } from '../api/client';
import { download } from '../lib/download';
import { useAppStore } from '../state/store';
import { sampleDoc } from '../test/fixtures';
import { PrintStep } from './PrintStep';

vi.mock('../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/client')>()),
  exportFile: vi.fn(),
  getFilamentPlan: vi.fn(),
  getModelSize: vi.fn(),
  getColorChanges: vi.fn(),
}));
vi.mock('../lib/download', () => ({ download: vi.fn() }));
// three.js needs WebGL; the preview only has to receive the request.
vi.mock('./ModelPreview', () => ({
  default: ({ onCancel }: { onCancel: () => void }) => (
    <div role="region" aria-label="3D model">
      <button type="button" onClick={onCancel}>
        Close preview
      </button>
    </div>
  ),
}));

const store = () => useAppStore.getState();
/** The summary tiles' values, e.g. "2 mm · 10 layers · base 1.6 mm · 80.0 × 40.0 mm · …". */
const summary = () =>
  [...screen.getByRole('status', { name: 'Print summary' }).querySelectorAll('dd')]
    .map((value) => value.textContent)
    .join(' · ');

describe('PrintStep', () => {
  beforeEach(() => {
    vi.mocked(exportFile).mockReset();
    vi.mocked(getFilamentPlan).mockReset();
    // The panel asks for the color changes (and the Kobra X for the size) on its own.
    vi.mocked(getModelSize).mockReset().mockResolvedValue({ x_mm: 80, y_mm: 40, z_mm: 2 });
    vi.mocked(getColorChanges)
      .mockReset()
      .mockResolvedValue({
        filaments: [
          { color: '#ffffff', volume_mm3: 9677.4, grams: 12 },
          { color: '#ff0000', volume_mm3: 241.9, grams: 0.3 },
        ],
        layers: 10,
        changes: 10,
        max_colors_per_layer: 2,
        change_time_s: 530,
        purge_mm3: 2260,
        purge_g: 2.8,
      });
    vi.mocked(download).mockReset();
    store().reset();
    useAppStore.setState({
      editor: sampleDoc(),
      file: new File(['png'], 'logo.png', { type: 'image/png' }),
    });
  });

  it('renders nothing without a document', () => {
    useAppStore.setState({ editor: null });
    const { container } = render(<PrintStep />);

    expect(container).toBeEmptyDOMElement();
  });

  it('applies a project and shows the total height', async () => {
    render(<PrintStep />);
    expect(summary()).toContain('2 mm · 10 layers'); // 8 base + 2 color layers of 0.2 mm

    await userEvent.click(screen.getByRole('radio', { name: /Fridge magnet/ }));
    expect(store().print).toMatchObject({ project: 'magnet', magnetMm: 10.2 });
    expect(summary()).toContain('2.8 mm · 14 layers');
  });

  it('raises an element selected in the design', async () => {
    const user = userEvent.setup();
    const { container } = render(<PrintStep />);

    await user.click(container.querySelector('path[d="M10,10 H30 V30 H10 Z"]')!);
    await user.click(screen.getByRole('button', { name: 'One layer higher' }));
    await user.click(screen.getByRole('button', { name: 'One layer higher' }));

    expect(store().print.shapeRaise).toEqual({ 'p-1-0': 2 });
    expect(summary()).toContain('12 layers');
    await user.click(screen.getByRole('button', { name: 'Clear selection' }));
    expect(screen.getByText(/Select elements in the design/)).toBeInTheDocument();
  });

  it('downloads the 3MF with the panel settings and reports failures', async () => {
    const user = userEvent.setup();
    vi.mocked(exportFile).mockResolvedValueOnce(new Blob(['3mf']));
    render(<PrintStep />);

    await user.click(screen.getByRole('button', { name: 'Download 3MF' }));
    await waitFor(() => expect(download).toHaveBeenCalledWith(expect.any(Blob), 'logo.3mf'));
    const [format, svg, options] = vi.mocked(exportFile).mock.calls[0];
    expect(format).toBe('3mf');
    expect(svg).toContain('id="p-1-0"');
    expect(options).toMatchObject({
      base_mm: 1.6,
      layered: false,
      stack_order: 'document',
      title: 'logo',
    });

    vi.mocked(exportFile).mockResolvedValueOnce(new Blob(['zip']));
    await user.click(screen.getByRole('button', { name: 'STL per color (ZIP)' }));
    await waitFor(() => expect(download).toHaveBeenCalledWith(expect.any(Blob), 'logo.parts.zip'));
    expect(vi.mocked(exportFile).mock.lastCall?.[0]).toBe('stl-parts');
    expect(vi.mocked(exportFile).mock.lastCall?.[2]).not.toHaveProperty('title');

    vi.mocked(exportFile).mockRejectedValueOnce(new Error('Backend down'));
    await user.click(screen.getByRole('button', { name: 'Download STL' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Backend down');
  });

  it('mixes colors from the loaded filaments and prints a test card', async () => {
    const user = userEvent.setup();
    vi.mocked(exportFile).mockResolvedValue(new Blob(['3mf']));
    render(<PrintStep />);

    await user.click(screen.getByRole('radio', { name: 'Mixed' }));
    expect(store().print).toMatchObject({ style: 'mixed', layerMm: 0.08, colorLayers: 15 });
    expect(screen.getByRole('group', { name: 'Loaded filaments' })).toBeInTheDocument();
    expect(screen.getByText('Mixed colors')).toBeInTheDocument();
    expect(screen.getByLabelText('Show predicted print colors')).toBeChecked();

    await user.click(screen.getByRole('button', { name: 'Download test card (3MF)' }));
    await waitFor(() =>
      expect(download).toHaveBeenCalledWith(expect.any(Blob), 'logo.test-card.3mf'),
    );
    const [, cardSvg, cardOptions] = vi.mocked(exportFile).mock.calls[0];
    expect(cardSvg).toContain('id="card-0"');
    expect(JSON.parse(String(cardOptions.filaments))[0]).toBe('#ffffff');
  });

  it('plans filament changes for stepped colors', async () => {
    const user = userEvent.setup();
    vi.mocked(getFilamentPlan).mockResolvedValueOnce({
      steps: [
        { z_mm: 0, layer: 1, color: '#ffffff' },
        { z_mm: 2, layer: 11, color: '#ff0000' },
      ],
      conflicts: [],
      height_mm: 2.4,
    });
    render(<PrintStep />);
    expect(screen.queryByRole('button', { name: 'Filament changes' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: 'Stepped' }));
    await user.click(screen.getByRole('button', { name: 'Filament changes' }));

    expect(await screen.findByRole('region', { name: 'Filament changes' })).toBeInTheDocument();
  });

  it('previews the model and marks the preview stale after changes', async () => {
    const user = userEvent.setup();
    render(<PrintStep />);
    await user.click(screen.getByRole('radio', { name: '3D preview' }));
    expect(screen.getByText('The 3D model appears here.')).toBeInTheDocument();

    await user.click(screen.getAllByRole('button', { name: 'Preview 3D' })[0]);
    expect(await screen.findByRole('region', { name: '3D model' })).toBeInTheDocument();
    expect(screen.queryByText(/Settings changed/)).not.toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: /Keychain/ }));
    expect(screen.getByText(/Settings changed/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'update the preview' }));
    expect(screen.queryByText(/Settings changed/)).not.toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: 'Design' }));
    expect(screen.getByRole('img', { name: /Design/ })).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: '3D preview' }));
    await user.click(await screen.findByRole('button', { name: 'Close preview' }));
    expect(screen.getByText('The 3D model appears here.')).toBeInTheDocument();
  });

  it('cancels a running download', async () => {
    const user = userEvent.setup();
    vi.mocked(exportFile).mockImplementation(
      (_format, _svg, _options, signal) =>
        new Promise((_resolve, reject) =>
          signal?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          ),
        ),
    );
    render(<PrintStep />);

    await user.click(screen.getByRole('button', { name: 'Download 3MF' }));
    expect(screen.getByText('Building the model')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download STL' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Download 3MF' })).toBeEnabled());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(download).not.toHaveBeenCalled();
  });

  it('reports planning failures and hides the predicted colors on request', async () => {
    const user = userEvent.setup();
    vi.mocked(getFilamentPlan).mockRejectedValueOnce(new Error('Plan failed'));
    const { container } = render(<PrintStep />);

    await user.click(screen.getByRole('radio', { name: 'Stepped' }));
    await user.click(screen.getByRole('button', { name: 'Filament changes' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Plan failed');

    await user.click(screen.getByRole('radio', { name: 'Mixed' }));
    const blue = () => container.querySelector('path[d^="M50,10"]')!.getAttribute('fill');
    const predicted = blue();
    await user.click(screen.getByLabelText('Show predicted print colors'));
    expect(blue()).toBe('#0000ff');
    expect(predicted).not.toBe('#0000ff');
  });

  it('goes back to the SVG editor', async () => {
    useAppStore.setState({
      step: 'print',
      vectorized: {
        width: 100,
        height: 50,
        palette: [],
        stats: { paths: 3, bytes: 1, duration_ms: 1 },
        svg: '',
      },
    });
    render(<PrintStep />);

    await userEvent.click(screen.getByRole('button', { name: 'Back to the SVG editor' }));
    expect(store().step).toBe('result');
  });

  it('checks the model against the Kobra X build volume and fits it to the bed', async () => {
    const user = userEvent.setup();
    vi.mocked(getModelSize).mockResolvedValue({ x_mm: 300, y_mm: 150, z_mm: 2 });
    store().setPrint({ printer: 'kobra-x', widthMm: 300 });
    render(<PrintStep />);

    expect(await screen.findByText(/too large for the Anycubic Kobra X/)).toBeInTheDocument();
    expect(vi.mocked(getModelSize).mock.calls.at(-1)?.[1]).toMatchObject({ width_mm: 300 });
    await user.click(screen.getByRole('button', { name: /Fit to the bed/ }));
    expect(store().print.widthMm).toBe(260);
  });

  it('warns about more colors than loaded filaments and goes back to use fewer', async () => {
    const user = userEvent.setup();
    useAppStore.setState({ limits: { ...store().limits, min_colors: 1 } });
    store().setPrint({ printer: 'kobra-x', filamentSlots: 1 });
    render(<PrintStep />);

    expect(screen.getByText(/needs 2 filaments; 1 is loaded/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Use 1 colors' }));
    expect(store()).toMatchObject({ step: 'palette', colors: 1 });
  });

  it('estimates the filament changes on the Kobra X with its change time and purge', async () => {
    store().setPrint({ printer: 'kobra-x' });
    render(<PrintStep />);

    expect(await screen.findByText(/10 filament changes/)).toBeInTheDocument();
    expect(vi.mocked(getColorChanges).mock.calls.at(-1)?.[1]).toMatchObject({
      change_s: 53,
      purge_mm3: 226,
      print_layer_mm: 0.2,
    });
  });

  it('shows the filament each color takes and the total, for any printer', async () => {
    render(<PrintStep />);

    // White (base plate included) and the summary's total.
    expect(await screen.findAllByText('≈ 12 g')).toHaveLength(2);
    expect(screen.getByText('≈ 0.3 g')).toBeInTheDocument();
    expect(summary()).toContain('≈ 12 g · solid model');
    expect(screen.queryByText(/filament changes/)).not.toBeInTheDocument(); // no change cost
  });

  it('marks a color the backend leaves out as too thin to print', async () => {
    vi.mocked(getColorChanges).mockResolvedValue({
      ...(await vi.mocked(getColorChanges).getMockImplementation()!('', {})),
      filaments: [{ color: '#ffffff', volume_mm3: 9677.4, grams: 12 }],
    });
    render(<PrintStep />);

    expect(await screen.findByText('too thin')).toBeInTheDocument();
  });

  it('shows the footprint of the model as exported, for any printer', async () => {
    vi.mocked(getModelSize).mockResolvedValue({ x_mm: 102.37, y_mm: 108.37, z_mm: 4.8 });
    render(<PrintStep />);

    await waitFor(() => expect(summary()).toContain('102 × 108 mm'));
  });

  it('names each printed color after the nearest filament the user has', async () => {
    render(<PrintStep />);

    // Sample design: white is close to the library's white; pure red is ΔE 12 from its red.
    expect(screen.getByText('≈ White')).toHaveAttribute('title', expect.stringMatching(/ΔE 2.0/));
    expect(screen.getByText('nearest: Red, ΔE 12')).toBeInTheDocument();

    useAppStore.setState({ filamentLibrary: { owned: ['#c12e1f'], custom: [] } }); // red only
    await waitFor(() => expect(screen.queryByText('≈ White')).not.toBeInTheDocument());
    expect(screen.getAllByText(/nearest: Red, ΔE \d+/)).toHaveLength(2);

    await userEvent.setup().click(screen.getByRole('radio', { name: 'Cut out' }));
    expect(screen.queryByText(/nearest:/)).not.toBeInTheDocument();
  });

  it('shows a mirrored stamp mirrored in the design view and exports it so', async () => {
    const user = userEvent.setup();
    vi.mocked(exportFile).mockResolvedValue(new Blob(['3mf']));
    render(<PrintStep />);

    await user.click(screen.getByLabelText('Mirror (stamps: print face down)'));
    expect(screen.getByText(/Shown mirrored, as it will print/)).toBeInTheDocument();
    expect(document.querySelector('.print-design--mirrored')).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'Download 3MF' }));
    await waitFor(() => expect(exportFile).toHaveBeenCalled());
    expect(vi.mocked(exportFile).mock.calls[0][2]).toMatchObject({ mirror: true });
  });

  it('numbers each color with its filament slot in the 3MF', async () => {
    render(<PrintStep />);

    // Response order: white (with the base plate) is filament 1, red filament 2.
    expect(await screen.findByTitle(/Filament 1 in the 3MF/)).toHaveTextContent('1');
    expect(screen.getByTitle(/Filament 2 in the 3MF: load it in slot 2/)).toHaveTextContent('2');

    await userEvent.setup().click(screen.getByRole('radio', { name: 'Cut out' }));
    expect(screen.queryByTitle(/in the 3MF/)).not.toBeInTheDocument(); // one filament
  });

  it('offers to undo a project, which changes many settings at once', async () => {
    const user = userEvent.setup();
    render(<PrintStep />);

    await user.click(screen.getByRole('radio', { name: /Keychain/ }));
    expect(screen.getByText(/Applied Keychain/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(store().print.project).toBe('custom');
    expect(screen.queryByText(/Applied Keychain/)).not.toBeInTheDocument();
  });
});
