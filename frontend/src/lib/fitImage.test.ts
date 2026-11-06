// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fitImage, fitScale } from './fitImage';

const MB = 1024 * 1024;
const LIMITS = { maxDimension: 4096, maxBytes: 10 * MB };

/** A browser stand-in: decodes to `width` × `height` and encodes `bytes(w, h)` bytes. */
function fakeBrowser(width: number, height: number, bytes: (w: number, h: number) => number) {
  const close = vi.fn();
  const decode = vi.fn().mockResolvedValue({ width, height, close });
  vi.stubGlobal('createImageBitmap', decode);
  const drawn: [number, number][] = [];
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (
    this: HTMLCanvasElement,
  ) {
    return {
      drawImage: (_: unknown, _x: number, _y: number, w: number, h: number) => drawn.push([w, h]),
    } as unknown as CanvasRenderingContext2D;
  } as unknown as HTMLCanvasElement['getContext']);
  const types: string[] = [];
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (
    this: HTMLCanvasElement,
    callback: BlobCallback,
    type?: string,
  ) {
    types.push(type ?? '');
    callback(new Blob([new Uint8Array(bytes(this.width, this.height))], { type }));
  });
  return { decode, close, drawn, types };
}

const photo = (size: number, type = 'image/jpeg', name = 'photo.jpg') =>
  new File([new Uint8Array(size)], name, { type });

describe('fitImage', () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  it('computes the scale that brings the longer side within the limit', () => {
    expect(fitScale(8064, 6048, 4096)).toBeCloseTo(4096 / 8064);
    expect(fitScale(1000, 5000, 4096)).toBeCloseTo(4096 / 5000);
    expect(fitScale(4096, 100, 4096)).toBe(1);
  });

  it('sends an image within the limits as chosen', async () => {
    const browser = fakeBrowser(4096, 3072, () => 1);
    const file = photo(5 * MB);

    expect(await fitImage(file, LIMITS)).toEqual({ file, resized: null });
    expect(browser.decode).toHaveBeenCalledWith(file, { imageOrientation: 'from-image' });
    expect(browser.drawn).toEqual([]);
    expect(browser.close).toHaveBeenCalled();
  });

  it('scales a photo larger than the server takes down to its longest side', async () => {
    const browser = fakeBrowser(8064, 6048, () => 4 * MB);

    const { file, resized } = await fitImage(photo(9 * MB), LIMITS);

    expect(resized).toEqual({ width: 8064, height: 6048, toWidth: 4096, toHeight: 3072 });
    expect(browser.drawn).toEqual([[4096, 3072]]);
    expect(file).toMatchObject({ name: 'photo.jpg', type: 'image/jpeg', size: 4 * MB });
    expect(browser.types).toEqual(['image/jpeg']);
  });

  it('keeps shrinking a file over the upload limit until it fits', async () => {
    // 1 byte per pixel: 3000 × 2000 is 6 MB; the limit is 2 MB.
    const browser = fakeBrowser(3000, 2000, (w, h) => w * h);

    const { file, resized } = await fitImage(photo(12 * MB), { ...LIMITS, maxBytes: 2 * MB });

    expect(browser.drawn).toEqual([
      [3000, 2000],
      [2250, 1500],
      [1688, 1125],
    ]);
    expect(resized).toEqual({ width: 3000, height: 2000, toWidth: 1688, toHeight: 1125 });
    expect(file.size).toBeLessThanOrEqual(2 * MB);
  });

  it('turns other formats into PNG, which keeps transparency', async () => {
    const browser = fakeBrowser(6000, 3000, () => MB);

    const { file } = await fitImage(photo(MB, 'image/webp', 'sticker.final.webp'), LIMITS);

    expect(browser.types).toEqual(['image/png']);
    expect(file).toMatchObject({ name: 'sticker.final.png', type: 'image/png' });
  });

  it('sends the file as chosen when it cannot be decoded or never fits', async () => {
    const file = photo(20 * MB);
    vi.stubGlobal('createImageBitmap', vi.fn().mockRejectedValue(new Error('unsupported')));
    expect(await fitImage(file, LIMITS)).toEqual({ file, resized: null });

    const browser = fakeBrowser(5000, 5000, () => 20 * MB);
    expect(await fitImage(file, LIMITS)).toEqual({ file, resized: null });
    expect(browser.drawn).toHaveLength(6);
    expect(browser.close).toHaveBeenCalled();
  });

  it('sends the file as chosen when drawing it fails', async () => {
    const browser = fakeBrowser(9000, 9000, () => 1);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(() => {
      throw new RangeError('Out of memory');
    });
    const file = photo(MB);

    expect(await fitImage(file, LIMITS)).toEqual({ file, resized: null });
    expect(browser.close).toHaveBeenCalled();
  });

  it('sends the file as chosen where the browser cannot decode images', async () => {
    vi.stubGlobal('createImageBitmap', undefined);
    const file = photo(20 * MB);

    expect(await fitImage(file, LIMITS)).toEqual({ file, resized: null });
  });
});
