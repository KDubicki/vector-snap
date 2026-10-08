// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAX_CANVAS_PIXELS, rasterSize, svgToPng } from './raster';

describe('rasterSize', () => {
  it('keeps the aspect ratio of the document', () => {
    expect(rasterSize(1000, 600, 2048)).toEqual({ width: 2048, height: 1229, limited: false });
    expect(rasterSize(10, 1000, 1)).toEqual({ width: 1, height: 100, limited: false });
  });

  it('never returns an empty image', () => {
    expect(rasterSize(1000, 1, 10)).toEqual({ width: 10, height: 1, limited: false });
  });

  it('shrinks images that exceed the canvas limit', () => {
    const size = rasterSize(1000, 1000, 16384);

    expect(size.limited).toBe(true);
    expect(size.width).toBe(size.height);
    expect(size.width * size.height).toBeLessThanOrEqual(MAX_CANVAS_PIXELS);
    expect(size.width).toBe(4096);
  });
});

describe('svgToPng', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete (HTMLImageElement.prototype as Partial<HTMLImageElement>).decode;
  });

  function stubCanvas(blob: Blob | null) {
    const context = { fillStyle: '', fillRect: vi.fn(), drawImage: vi.fn() };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      context as unknown as CanvasRenderingContext2D,
    );
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) =>
      callback(blob),
    );
    // jsdom does not implement image decoding.
    HTMLImageElement.prototype.decode = vi.fn().mockResolvedValue(undefined);
    URL.createObjectURL = vi.fn(() => 'blob:svg');
    URL.revokeObjectURL = vi.fn();
    return context;
  }

  it('draws the svg at the requested size on the background', async () => {
    const png = new Blob(['png'], { type: 'image/png' });
    const context = stubCanvas(png);

    const result = await svgToPng('<svg/>', { width: 40, height: 20 }, '#ffffff');

    expect(result).toBe(png);
    expect(context.fillStyle).toBe('#ffffff');
    expect(context.fillRect).toHaveBeenCalledWith(0, 0, 40, 20);
    expect(context.drawImage).toHaveBeenCalledWith(expect.any(HTMLImageElement), 0, 0, 40, 20);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:svg');
  });

  it('keeps transparency and reports images the browser cannot encode', async () => {
    const context = stubCanvas(null);

    await expect(svgToPng('<svg/>', { width: 40, height: 20 }, null)).rejects.toThrow('too large');
    expect(context.fillRect).not.toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalled();
  });
});
