// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_PRINT } from '../lib/printPlan';
import { printerById } from '../lib/printers';
import { BuildVolumeCheck } from './BuildVolumeCheck';

const kobraX = printerById('kobra-x');
const settings = { ...DEFAULT_PRINT, printer: 'kobra-x' as const, widthMm: 300 };

describe('BuildVolumeCheck', () => {
  it('says the model fits, and checks while the size is unknown', () => {
    const { rerender } = render(
      <BuildVolumeCheck printer={kobraX} settings={settings} size={null} onChange={vi.fn()} />,
    );
    expect(screen.getByRole('status')).toHaveTextContent(
      'Checking the size for the Anycubic Kobra X',
    );

    rerender(
      <BuildVolumeCheck
        printer={kobraX}
        settings={settings}
        size={{ x_mm: 102.37, y_mm: 108.37, z_mm: 4.8 }}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent(
      'Model 102.4 × 108.4 × 4.8 mm — fits the Anycubic Kobra X (260 × 260 × 260 mm).',
    );
  });

  it('flags a model too large for the bed and fits it', async () => {
    const onChange = vi.fn();
    render(
      <BuildVolumeCheck
        printer={kobraX}
        settings={settings}
        size={{ x_mm: 300, y_mm: 150, z_mm: 3 }}
        onChange={onChange}
      />,
    );

    expect(
      screen.getByText(/too large for the Anycubic Kobra X: 300 mm wide \(max 260\)/),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Fit to the bed (260 mm wide)' }));
    expect(onChange).toHaveBeenCalledWith({ widthMm: 260 });
  });

  it('offers tiles of the bed for a footprint too large, keeping the size', async () => {
    const onTiles = vi.fn();
    const size = { x_mm: 410, y_mm: 300, z_mm: 3 };
    const { rerender } = render(
      <BuildVolumeCheck
        printer={kobraX}
        settings={settings}
        size={size}
        onChange={vi.fn()}
        onTiles={onTiles}
      />,
    );

    expect(screen.getByText(/2 × 2 tiles of 205 × 150 mm/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Download in 4 tiles (3MF, ZIP)' }));
    expect(onTiles).toHaveBeenCalled();

    rerender(
      <BuildVolumeCheck printer={kobraX} settings={settings} size={size} onChange={vi.fn()} />,
    );
    expect(screen.getByRole('button', { name: /Download in 4 tiles/ })).toBeDisabled();
  });

  it('offers no tiles for a model only too tall', () => {
    render(
      <BuildVolumeCheck
        printer={kobraX}
        settings={settings}
        size={{ x_mm: 100, y_mm: 100, z_mm: 300 }}
        onChange={vi.fn()}
        onTiles={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button', { name: /tiles/ })).not.toBeInTheDocument();
  });

  it('shows nothing for a printer without a known build volume', () => {
    const { container } = render(
      <BuildVolumeCheck
        printer={printerById('any')}
        settings={DEFAULT_PRINT}
        size={null}
        onChange={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
