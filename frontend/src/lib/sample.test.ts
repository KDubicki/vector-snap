import { afterEach, describe, expect, it, vi } from 'vitest';
import { SAMPLE_IMAGE_URL, loadSampleImage } from './sample';

describe('sample image', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('loads the bundled image as a png file', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(new Blob(['png'])));
    vi.stubGlobal('fetch', fetchMock);

    const file = await loadSampleImage();

    expect(fetchMock).toHaveBeenCalledWith(SAMPLE_IMAGE_URL, { signal: undefined });
    expect(file.name).toBe('sample.png');
    expect(file.type).toBe('image/png');
    expect(await file.text()).toBe('png');
  });

  it('fails with a readable message when the image is missing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 404 })));

    await expect(loadSampleImage()).rejects.toThrow('Could not load the sample image.');
  });
});
