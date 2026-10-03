import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { QuantizeResponse, VectorizeResponse } from '../types/api';
import { DEFAULT_COLORS, useAppStore } from './store';

const quantized: QuantizeResponse = {
  width: 2,
  height: 1,
  palette: [
    { index: 0, hex: '#ff0000', coverage: 0.5 },
    { index: 1, hex: '#00ff00', coverage: 0.5 },
  ],
  has_transparency: false,
  image: { media_type: 'image/png', encoding: 'base64', data: btoa('png') },
};

const vectorized: VectorizeResponse = {
  width: 2,
  height: 1,
  palette: quantized.palette,
  stats: { paths: 2, bytes: 100, duration_ms: 5 },
  svg: '<svg/>',
};

function respond(body: unknown, status = 200) {
  return vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }));
}

const file = new File(['img'], 'logo.png', { type: 'image/png' });
const store = () => useAppStore.getState();

describe('app store', () => {
  beforeEach(() => store().reset());
  afterEach(() => vi.unstubAllGlobals());

  it('moves to the palette step when a file is selected', () => {
    store().selectFile(file);

    expect(store().step).toBe('palette');
    expect(store().file).toBe(file);
  });

  it('rejects files over the upload limit without changing step', () => {
    useAppStore.setState({ limits: { min_colors: 2, max_colors: 64, max_upload_mb: 0 } });

    store().selectFile(file);

    expect(store().step).toBe('upload');
    expect(store().error).toMatch('larger than 0 MB');
  });

  it('loads limits and clamps the color count', async () => {
    vi.stubGlobal('fetch', respond({ min_colors: 2, max_colors: 4, max_upload_mb: 5 }));

    await store().loadLimits();

    expect(store().limits.max_colors).toBe(4);
    expect(store().colors).toBe(4);
  });

  it('keeps default limits when the request fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));

    await store().loadLimits();

    expect(store().colors).toBe(DEFAULT_COLORS);
  });

  it('quantizes the selected file and resets overrides', async () => {
    store().selectFile(file);
    store().setOverride(0, '#123456');
    vi.stubGlobal('fetch', respond(quantized));

    await store().runQuantize();

    expect(store().quantized).toEqual(quantized);
    expect(store().overrides).toEqual({});
    expect(store().status).toBe('idle');
  });

  it('does not re-quantize (and drop edits) when parameters are unchanged', async () => {
    store().selectFile(file);
    const fetchMock = respond(quantized);
    vi.stubGlobal('fetch', fetchMock);
    await store().runQuantize();
    store().setOverride(0, '#123456');

    await store().runQuantize();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(store().overrides).toEqual({ 0: '#123456' });

    vi.stubGlobal('fetch', respond(quantized));
    store().setColors(4);
    await store().runQuantize();
    expect(store().overrides).toEqual({});
  });

  it('stores api errors from quantization', async () => {
    store().selectFile(file);
    vi.stubGlobal(
      'fetch',
      respond({ error: { code: 'INVALID_IMAGE', message: 'Broken', details: {} } }, 422),
    );

    await store().runQuantize();

    expect(store().error).toBe('Broken');
    expect(store().status).toBe('idle');
  });

  it('ignores aborted requests', async () => {
    store().selectFile(file);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('aborted', 'AbortError')));

    await store().runQuantize();

    expect(store().error).toBeNull();
    expect(store().status).toBe('quantizing');
  });

  it('manages palette overrides', () => {
    store().setOverride(1, '#ABCDEF');
    store().setOverride(2, '#000000');
    store().resetOverride(2);

    expect(store().overrides).toEqual({ 1: '#abcdef' });

    store().resetOverrides();
    expect(store().overrides).toEqual({});
  });

  it('vectorizes with the final palette and tracing options', async () => {
    useAppStore.setState({ quantized, overrides: { 1: '#0000ff' } });
    store().setTracing({ mode: 'polygon' });
    const fetchMock = respond(vectorized);
    vi.stubGlobal('fetch', fetchMock);

    await store().runVectorize();

    const form = (fetchMock.mock.calls[0] as [string, RequestInit])[1].body as FormData;
    expect(form.get('palette')).toBe('["#ff0000","#0000ff"]');
    expect(form.get('mode')).toBe('polygon');
    expect(form.get('stacking')).toBe('cutout');
    expect(store().vectorized).toEqual(vectorized);
    expect(store().step).toBe('result');
  });

  it('reports vectorization errors and stays on the palette step', async () => {
    useAppStore.setState({ quantized, step: 'palette' });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network down')));

    await store().runVectorize();

    expect(store().error).toBe('Network down');
    expect(store().step).toBe('palette');
  });

  it('does nothing without input', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await store().runQuantize();
    await store().runVectorize();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('navigates and resets', () => {
    store().selectFile(file);
    store().setColors(12);
    store().setAlgorithm('median_cut');
    store().goTo('upload');
    expect(store().step).toBe('upload');

    store().reset();
    expect(store().file).toBeNull();
    expect(store().colors).toBe(DEFAULT_COLORS);
    expect(store().algorithm).toBe('kmeans');
  });
});
