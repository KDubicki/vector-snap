// @vitest-environment jsdom
import { render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DIMMED_ALPHA } from '../lib/recolor';
import { QUANTIZED } from '../test/fixtures';
import { QuantizedPreview } from './QuantizedPreview';

class LoadingImage {
  onload: (() => void) | null = null;
  naturalWidth = 2;
  naturalHeight = 1;
  set src(_value: string) {
    setTimeout(() => this.onload?.());
  }
}

class FakeImageData {
  constructor(
    readonly data: Uint8ClampedArray,
    readonly width: number,
    readonly height: number,
  ) {}
}

describe('QuantizedPreview', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('draws the image and recolors it when the palette changes', async () => {
    vi.stubGlobal('Image', LoadingImage);
    vi.stubGlobal('ImageData', FakeImageData);
    // Red and green pixels, as decoded from the quantized PNG.
    const base = new FakeImageData(new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255]), 2, 1);
    const context = {
      drawImage: vi.fn(),
      getImageData: vi.fn(() => base),
      putImageData: vi.fn(),
    };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      context as unknown as CanvasRenderingContext2D,
    );
    const palette = ['#ff0000', '#00ff00'];

    const { container, rerender } = render(
      <QuantizedPreview
        image={QUANTIZED.image}
        originalPalette={palette}
        targetPalette={palette}
      />,
    );
    await waitFor(() => expect(context.putImageData).toHaveBeenCalled());
    expect(container.querySelector('canvas')).toHaveAttribute('width', '2');

    rerender(
      <QuantizedPreview
        image={QUANTIZED.image}
        originalPalette={palette}
        targetPalette={['#0000ff', null]}
      />,
    );
    const pixels = context.putImageData.mock.lastCall![0].data as Uint8ClampedArray;
    expect([...pixels]).toEqual([0, 0, 255, 255, 0, 255, 0, 0]); // blue, removed (alpha 0)

    rerender(
      <QuantizedPreview
        image={QUANTIZED.image}
        originalPalette={palette}
        targetPalette={palette}
        highlight="#00ff00"
      />,
    );
    const highlighted = context.putImageData.mock.lastCall![0].data as Uint8ClampedArray;
    expect([...highlighted]).toEqual([255, 0, 0, DIMMED_ALPHA, 0, 255, 0, 255]); // red faded
  });
});
