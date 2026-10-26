// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { useAppStore } from './state/store';
import { QUANTIZED, VECTORIZED, fetchResponses } from './test/fixtures';

const store = () => useAppStore.getState();
const LIMITS = { min_colors: 2, max_colors: 32, max_upload_mb: 5 };

describe('App', () => {
  beforeEach(() => {
    store().reset();
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:x');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('loads the limits and starts with the upload step', async () => {
    vi.stubGlobal('fetch', fetchResponses(LIMITS));
    render(<App />);

    expect(await screen.findByText('JPEG or PNG, up to 5 MB')).toBeInTheDocument();
    expect(screen.getByText('Upload').closest('li')).toHaveAttribute('aria-current', 'step');
    expect(screen.queryByRole('button', { name: /Colors/ })).not.toBeInTheDocument();
  });

  it('shows rejected uploads as an error', async () => {
    vi.stubGlobal('fetch', fetchResponses(LIMITS));
    render(<App />);

    await userEvent.upload(
      screen.getByLabelText('Choose image'),
      new File(['gif'], 'a.gif', { type: 'image/gif' }),
      { applyAccept: false },
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Only JPEG and PNG');
  });

  it('moves between reachable steps and warns before leaving with unsaved edits', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('fetch', fetchResponses(VECTORIZED));
    useAppStore.setState({
      file: new File(['png'], 'logo.png', { type: 'image/png' }),
      quantized: QUANTIZED,
    });
    await store().runVectorize();
    vi.stubGlobal('fetch', fetchResponses(LIMITS));
    render(<App />);
    expect(screen.getByLabelText('SVG editor canvas')).toBeInTheDocument();

    const steps = within(screen.getByRole('navigation', { name: 'Steps' }));
    const scrollTo = vi.spyOn(window, 'scrollTo');
    await user.click(steps.getByRole('button', { name: /3D print/ }));
    expect(store().step).toBe('print');
    expect(scrollTo).toHaveBeenCalledWith(0, 0);
    await user.click(steps.getByRole('button', { name: /SVG/ }));
    expect(store().step).toBe('result');

    const unload = () => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(unload()).toBe(false);
    store().select('p-0-0');
    store().deleteSelection();
    await waitFor(() => expect(unload()).toBe(true));
  });

  it('opens the palette step for a chosen image', async () => {
    vi.stubGlobal('fetch', fetchResponses(LIMITS, QUANTIZED));
    render(<App />);

    await userEvent.upload(
      screen.getByLabelText('Choose image'),
      new File(['png'], 'logo.png', { type: 'image/png' }),
    );
    expect(store().step).toBe('palette');
    expect(screen.getByRole('button', { name: 'Convert to SVG' })).toBeInTheDocument();
  });
});
