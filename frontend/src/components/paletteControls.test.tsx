// @vitest-environment jsdom
import { createEvent, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_TRACING } from '../lib/tracing';
import type { PaletteColor } from '../types/api';
import { ColorCountSelector } from './ColorCountSelector';
import { ImageUpload } from './ImageUpload';
import { LockedColors } from './LockedColors';
import { PaletteEditor } from './PaletteEditor';
import { TracingOptionsPanel } from './TracingOptionsPanel';

const png = new File(['png'], 'logo.png', { type: 'image/png' });
const gif = new File(['gif'], 'logo.gif', { type: 'image/gif' });

describe('ImageUpload', () => {
  afterEach(() => vi.unstubAllGlobals());

  const renderUpload = () => {
    const onSelect = vi.fn();
    const onReject = vi.fn();
    render(<ImageUpload maxUploadMb={10} onSelect={onSelect} onReject={onReject} />);
    return { onSelect, onReject, zone: screen.getByText('Drop a JPEG or PNG here').parentElement! };
  };

  it('accepts JPEG and PNG files from the file picker', async () => {
    const { onSelect } = renderUpload();

    await userEvent.upload(screen.getByLabelText('Choose image'), png);
    expect(onSelect).toHaveBeenCalledWith(png);
    expect(screen.getByText('JPEG or PNG, up to 10 MB')).toBeInTheDocument();
  });

  it('rejects other file types', () => {
    const { onSelect, onReject } = renderUpload();

    fireEvent.change(screen.getByLabelText('Choose image'), { target: { files: [gif] } });
    expect(onSelect).not.toHaveBeenCalled();
    expect(onReject).toHaveBeenCalledWith('Only JPEG and PNG images are supported.');
  });

  it('shows a drop target while dragging and takes the dropped file', () => {
    const { onSelect, zone } = renderUpload();

    fireEvent.dragOver(zone);
    expect(screen.getByText('Release to upload')).toBeInTheDocument();
    fireEvent.dragLeave(zone, { relatedTarget: document.body });
    expect(screen.getByText('Drop a JPEG or PNG here')).toBeInTheDocument();

    fireEvent.drop(zone, { dataTransfer: { files: [png] } });
    expect(onSelect).toHaveBeenCalledWith(png);
  });

  it('takes an image pasted from the clipboard', () => {
    const { onSelect } = renderUpload();
    const paste = createEvent.paste(window, {});
    Object.defineProperty(paste, 'clipboardData', { value: { files: [png] } });

    fireEvent(window, paste);
    expect(onSelect).toHaveBeenCalledWith(png);
  });

  it('loads the sample image, or explains why it could not', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(new Response(new Blob(['png']), { status: 200 }))
        .mockResolvedValueOnce(new Response('', { status: 404 })),
    );
    const { onSelect, onReject } = renderUpload();

    await user.click(screen.getByRole('button', { name: /Try a sample/ }));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ name: 'sample.png' }));
    await user.click(screen.getByRole('button', { name: /Try a sample/ }));
    expect(onReject).toHaveBeenCalledWith('Could not load the sample image.');
  });
});

describe('ColorCountSelector', () => {
  const renderSelector = (props: Partial<Parameters<typeof ColorCountSelector>[0]> = {}) => {
    const onChange = vi.fn();
    const onSuggest = vi.fn();
    render(
      <ColorCountSelector
        value={8}
        min={2}
        max={16}
        onChange={onChange}
        suggested={null}
        suggesting={false}
        onSuggest={onSuggest}
        {...props}
      />,
    );
    return { onChange, onSuggest };
  };

  it('changes the count with the slider and the number field (clamped)', () => {
    const { onChange } = renderSelector();

    fireEvent.change(screen.getByRole('slider'), { target: { value: '5' } });
    expect(onChange).toHaveBeenLastCalledWith(5);
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Number of colors' }), {
      target: { value: '40' },
    });
    expect(onChange).toHaveBeenLastCalledWith(16);
  });

  it('suggests a count and applies it', async () => {
    const { onChange, onSuggest } = renderSelector({ suggested: 6 });

    await userEvent.click(screen.getByRole('button', { name: 'Suggest' }));
    expect(onSuggest).toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('Suggested for this image: 6 colors');
    await userEvent.click(screen.getByRole('button', { name: 'use it' }));
    expect(onChange).toHaveBeenCalledWith(6);
  });

  it('hides "use it" when the suggestion is applied and disables while suggesting', () => {
    renderSelector({ suggested: 8, suggesting: true });

    expect(screen.queryByRole('button', { name: 'use it' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Suggesting…' })).toBeDisabled();
  });
});

describe('LockedColors', () => {
  it('adds a brand color and unlocks locked ones', async () => {
    const onLock = vi.fn();
    const onUnlock = vi.fn();
    render(<LockedColors locked={['#ff0000']} canLock onLock={onLock} onUnlock={onUnlock} />);

    fireEvent.input(screen.getByLabelText('Brand color to lock'), { target: { value: '#00ff00' } });
    await userEvent.click(screen.getByRole('button', { name: 'Lock color' }));
    expect(onLock).toHaveBeenCalledWith('#00ff00');
    await userEvent.click(screen.getByRole('button', { name: 'Unlock #ff0000' }));
    expect(onUnlock).toHaveBeenCalledWith('#ff0000');
  });

  it('explains locking and blocks it without a free slot or for a locked color', () => {
    const { rerender } = render(
      <LockedColors locked={[]} canLock={false} onLock={vi.fn()} onUnlock={vi.fn()} />,
    );
    expect(screen.getByText(/Lock palette colors or add brand colors/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Lock color' })).toBeDisabled();

    rerender(<LockedColors locked={['#000000']} canLock onLock={vi.fn()} onUnlock={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Lock color' })).toBeDisabled();
  });
});

describe('PaletteEditor', () => {
  const palette: PaletteColor[] = [
    { index: 0, hex: '#ffffff', coverage: 0.6 },
    { index: 1, hex: '#ff0000', coverage: 0.3 },
    { index: 2, hex: '#0000ff', coverage: 0.1 },
  ];
  const renderEditor = (props: Partial<Parameters<typeof PaletteEditor>[0]> = {}) => {
    const handlers = {
      onLock: vi.fn(),
      onUnlock: vi.fn(),
      onToggleTransparent: vi.fn(),
      onChange: vi.fn(),
      onReset: vi.fn(),
      onResetAll: vi.fn(),
    };
    render(
      <PaletteEditor
        palette={palette}
        overrides={{}}
        locked={[]}
        canLock
        transparent={[]}
        backgroundIndex={0}
        {...handlers}
        {...props}
      />,
    );
    return handlers;
  };

  it('recolors, locks and removes palette colors', async () => {
    const user = userEvent.setup();
    const handlers = renderEditor();

    expect(screen.getByText('60.0%')).toBeInTheDocument();
    fireEvent.input(screen.getByLabelText('Palette color 2: #ff0000'), {
      target: { value: '#00ff00' },
    });
    expect(handlers.onChange).toHaveBeenCalledWith(1, '#00ff00');
    await user.click(screen.getByRole('button', { name: 'Lock #0000ff' }));
    expect(handlers.onLock).toHaveBeenCalledWith('#0000ff');
    await user.click(screen.getByRole('button', { name: 'Remove #ff0000' }));
    expect(handlers.onToggleTransparent).toHaveBeenCalledWith(1);
    await user.click(screen.getByRole('button', { name: 'Remove background' }));
    expect(handlers.onToggleTransparent).toHaveBeenLastCalledWith(0);
    expect(screen.getByRole('button', { name: 'Reset all' })).toBeDisabled();
  });

  it('resets overrides and unlocks locked rows', async () => {
    const user = userEvent.setup();
    const handlers = renderEditor({ overrides: { 1: '#00ff00' }, locked: ['#ff0000'] });

    expect(screen.getByText('#00ff00')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reset' }));
    expect(handlers.onReset).toHaveBeenCalledWith(1);
    await user.click(screen.getByRole('button', { name: 'Reset all' }));
    expect(handlers.onResetAll).toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Unlock #ff0000' }));
    expect(handlers.onUnlock).toHaveBeenCalledWith('#ff0000');
  });

  it('keeps the last visible color and restores removed ones', async () => {
    const handlers = renderEditor({ transparent: [0, 1], canLock: false });

    expect(screen.getByRole('button', { name: 'Remove #0000ff' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Lock #0000ff' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Remove background' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Restore #ffffff' }));
    expect(handlers.onToggleTransparent).toHaveBeenCalledWith(0);
  });
});

describe('TracingOptionsPanel', () => {
  it('changes curves, stacking and numbers within limits, and restores defaults', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onReset = vi.fn();
    const { rerender } = render(
      <TracingOptionsPanel options={DEFAULT_TRACING} onChange={onChange} onReset={onReset} />,
    );
    expect(screen.getByRole('button', { name: 'Restore defaults' })).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Curves'), { target: { value: 'polygon' } });
    expect(onChange).toHaveBeenLastCalledWith({ mode: 'polygon' });
    fireEvent.change(screen.getByLabelText('Shapes'), { target: { value: 'stacked' } });
    expect(onChange).toHaveBeenLastCalledWith({ stacking: 'stacked' });

    const speckle = screen.getByLabelText('Remove specks smaller than (px)');
    onChange.mockClear();
    await user.clear(speckle);
    await user.type(speckle, '1000'); // above the limit: not committed while typing
    expect(speckle).toHaveValue(1000);
    await user.tab(); // clamped on blur
    expect(onChange).toHaveBeenLastCalledWith({
      filter_speckle: expect.any(Number),
    });
    expect(onChange.mock.lastCall![0].filter_speckle).toBeLessThan(1000);

    rerender(
      <TracingOptionsPanel
        options={{ ...DEFAULT_TRACING, mode: 'polygon' }}
        onChange={onChange}
        onReset={onReset}
      />,
    );
    expect(screen.getByLabelText('Minimum segment length (px)')).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Restore defaults' }));
    expect(onReset).toHaveBeenCalled();
  });
});
