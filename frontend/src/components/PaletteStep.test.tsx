// @vitest-environment jsdom
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../state/store';
import { QUANTIZED, VECTORIZED, fetchResponses } from '../test/fixtures';
import { PaletteStep } from './PaletteStep';

const store = () => useAppStore.getState();
const file = new File(['png'], 'logo.png', { type: 'image/png' });

describe('PaletteStep', () => {
  beforeEach(() => {
    store().reset();
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:original');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('reduces the colors of a new file after a short pause', async () => {
    vi.useFakeTimers();
    const fetch = fetchResponses(QUANTIZED);
    vi.stubGlobal('fetch', fetch);
    useAppStore.setState({ file, step: 'palette' });
    render(<PaletteStep />);
    expect(screen.getByText('Reducing colors…')).toBeInTheDocument();
    expect(screen.getByAltText('Original upload')).toHaveAttribute('src', 'blob:original');

    await act(() => vi.advanceTimersByTimeAsync(400));
    vi.useRealTimers();

    await screen.findByText('Reduced to 2 colors');
    expect(fetch).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Convert to SVG' })).toBeEnabled();
  });

  it('changes method, smoothing and upscaling', async () => {
    const user = userEvent.setup();
    useAppStore.setState({ file, quantized: QUANTIZED });
    vi.stubGlobal('fetch', fetchResponses(QUANTIZED));
    render(<PaletteStep />);

    const more = screen.getByText('More color options');
    expect(more).toHaveTextContent('Smooth: Light · similar: Close · small: 2% · enlarge');
    await user.click(more);
    await user.click(screen.getByRole('radio', { name: 'Fast (median cut)' }));
    await user.click(screen.getByRole('radio', { name: 'Strong' }));
    await user.click(screen.getByLabelText('Enlarge small images'));
    expect(more).toHaveTextContent('Smooth: Strong · similar: Close · small: 2%');
    expect(more).not.toHaveTextContent('enlarge');

    expect(store()).toMatchObject({ algorithm: 'median_cut', smooth: 3, upscale: false });
    expect(screen.getByRole('radio', { name: 'Strong' })).toHaveAttribute('aria-checked', 'true');
  });

  it('picks the palette from my filaments and names its colors', async () => {
    const user = userEvent.setup();
    const fromFilaments = {
      ...QUANTIZED,
      palette: [
        { index: 0, hex: '#f7f7f5', coverage: 0.7 },
        { index: 1, hex: '#c12e1f', coverage: 0.3 },
      ],
    };
    useAppStore.setState({ file, quantized: fromFilaments });
    // The debounced re-quantize after choosing the algorithm can fire mid-test on a slow
    // runner: it gets the same palette back, so the names stay.
    vi.stubGlobal('fetch', fetchResponses(fromFilaments));
    render(<PaletteStep />);
    expect(screen.queryByText('Available filaments')).not.toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: 'My filaments' }));
    expect(store().algorithm).toBe('filaments');
    expect(screen.getByText('Available filaments')).toBeInTheDocument();
    expect(screen.getByText(/chosen from the filaments you have/)).toBeInTheDocument();
    expect(screen.getByText('Red', { selector: 'small' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'None' }));
    expect(store().filamentLibrary.owned).toEqual([]);
    await user.click(screen.getByRole('button', { name: 'All' }));
  });

  it('removes the background and converts to SVG', async () => {
    const user = userEvent.setup();
    // Quantized for the current settings, so the debounced re-quantize after mounting
    // (which would clear the removed background on slow runners) does nothing.
    const { colors, algorithm, smooth, upscale, minCoverage, mergeDeltaE, locked } = store();
    useAppStore.setState({
      file,
      quantized: QUANTIZED,
      quantizedFor: {
        file,
        colors,
        algorithm,
        smooth,
        upscale,
        minCoverage,
        mergeDeltaE,
        locked,
        filaments: '',
      },
    });
    vi.stubGlobal('fetch', fetchResponses(VECTORIZED));
    render(<PaletteStep />);

    await user.click(screen.getByRole('button', { name: 'Remove background' }));
    expect(store().background).toBe(0);
    expect(store().transparent).toEqual([]);
    await user.click(screen.getByRole('button', { name: 'Convert to SVG' }));

    await waitFor(() => expect(store().step).toBe('result'));
    expect(store().editor?.groups).toHaveLength(2);
  });

  it('asks before replacing an edited SVG', async () => {
    const user = userEvent.setup();
    // The palette step re-quantizes 400 ms after mounting; slow runners get there mid-test.
    vi.stubGlobal('fetch', fetchResponses(VECTORIZED, QUANTIZED));
    useAppStore.setState({ file, quantized: QUANTIZED });
    await store().runVectorize();
    store().select('p-0-0');
    store().deleteSelection(); // an unsaved edit
    useAppStore.setState({ step: 'palette' });
    render(<PaletteStep />);

    await user.click(screen.getByRole('button', { name: 'New image' }));
    const dialog = screen.getByRole('dialog', { name: 'Discard your SVG edits?' });
    await user.click(within(dialog).getByRole('button', { name: 'Keep editing' }));
    expect(store().file).toBe(file);

    await user.click(screen.getByRole('button', { name: 'New image' }));
    await user.click(screen.getByRole('button', { name: 'Discard edits' }));
    expect(store().file).toBeNull();
  });
});
