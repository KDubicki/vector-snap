// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../state/store';
import { QUANTIZED, VECTORIZED, fetchResponses } from '../test/fixtures';
import { ResultStep } from './ResultStep';

const store = () => useAppStore.getState();

describe('ResultStep', () => {
  beforeEach(async () => {
    store().reset();
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:svg');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    vi.stubGlobal('fetch', fetchResponses(VECTORIZED));
    useAppStore.setState({
      file: new File(['png'], 'logo.png', { type: 'image/png' }),
      quantized: QUANTIZED,
    });
    await store().runVectorize();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('shows stats and downloads the SVG, marking it saved', async () => {
    render(<ResultStep />);

    expect(screen.getByText('Shapes').nextSibling).toHaveTextContent('2');
    expect(screen.getByText('5 ms')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Download SVG' });
    expect(link).toHaveAttribute('download', 'logo.svg');
    expect(link).toHaveAttribute('href', 'blob:svg');

    store().select('p-0-0');
    store().deleteSelection();
    const edited = await screen.findByRole('link', { name: 'Download edited SVG' });
    edited.addEventListener('click', (event) => event.preventDefault()); // no navigation
    await userEvent.click(edited);
    expect(store().savedDoc).toBe(store().editor);
  });

  it('compares with the original and opens the other steps', async () => {
    const user = userEvent.setup();
    render(<ResultStep />);

    await user.click(screen.getByRole('radio', { name: 'Compare with original' }));
    expect(screen.getByAltText('SVG result')).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'Edit' }));
    expect(screen.getByLabelText('SVG editor canvas')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /3D print/ }));
    expect(store().step).toBe('print');
    await user.click(screen.getByRole('button', { name: 'Back to colors' }));
    expect(store().step).toBe('palette');
  });

  it('asks before starting over with unsaved edits', async () => {
    const user = userEvent.setup();
    store().select('p-0-0');
    store().deleteSelection();
    render(<ResultStep />);

    await user.click(screen.getByRole('button', { name: 'Start with a new image' }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Discard edits' }));
    expect(store().step).toBe('upload');
  });

  it('renders nothing before a result exists', () => {
    store().reset();
    const { container } = render(<ResultStep />);
    expect(container).toBeEmptyDOMElement();
  });
});
