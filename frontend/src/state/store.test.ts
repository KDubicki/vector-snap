// @vitest-environment jsdom
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
  svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 10"><g data-palette-index="0" fill="#ff0000"><path id="p-0-0" d="M0,0 L10,0 L10,10 Z"/><path id="p-0-1" d="M10,0 L20,0 L20,10 Z"/></g></svg>',
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
    expect(store().editor?.groups[0].shapes.map((s) => s.id)).toEqual(['p-0-0', 'p-0-1']);
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

  it('selects shapes, toggles with additive selection and ignores unknown ids', async () => {
    useAppStore.setState({ quantized });
    vi.stubGlobal('fetch', respond(vectorized));
    await store().runVectorize();

    store().select('p-0-0');
    store().select('p-0-1', true);
    expect(store().selection).toEqual(['p-0-0', 'p-0-1']);

    store().select('p-0-0', true);
    expect(store().selection).toEqual(['p-0-1']);

    store().select('missing', true);
    expect(store().selection).toEqual(['p-0-1']);

    store().select('p-0-0');
    expect(store().selection).toEqual(['p-0-0']);

    store().select(null);
    expect(store().selection).toEqual([]);
  });

  it('recolors the selection and whole groups', async () => {
    useAppStore.setState({ quantized });
    vi.stubGlobal('fetch', respond(vectorized));
    await store().runVectorize();

    store().recolorSelection('#00ff00');
    expect(store().editor?.groups[0].shapes[0].fill).toBeUndefined();

    store().select('p-0-1');
    store().recolorSelection('#00ff00');
    expect(store().editor?.groups[0].shapes[1].fill).toBe('#00ff00');

    store().resetSelectionColor();
    expect(store().editor?.groups[0].shapes[1].fill).toBeUndefined();

    store().recolorGroup(0, '#123456');
    expect(store().editor?.groups[0].fill).toBe('#123456');
  });

  it('splits shapes along a line and selects the parts', async () => {
    useAppStore.setState({ quantized });
    vi.stubGlobal('fetch', respond(vectorized));
    await store().runVectorize();
    // p-0-0 is the triangle (0,0) (10,0) (10,10); a vertical cut at x = 7.5 crosses it
    const line = [
      { x: 7.5, y: -1 },
      { x: 7.5, y: 11 },
    ];

    store().select('p-0-0');
    store().splitWithLine(line);

    expect(store().selection).toEqual(['p-0-0.a', 'p-0-0.b']);
    expect(store().editor?.groups[0].shapes.map((s) => s.id)).toEqual([
      'p-0-0.a',
      'p-0-0.b',
      'p-0-1',
    ]);
    expect(store().notice).toBeNull();
  });

  it('explains when a line splits nothing and clears the hint on selection', async () => {
    useAppStore.setState({ quantized });
    vi.stubGlobal('fetch', respond(vectorized));
    await store().runVectorize();

    store().splitWithLine([
      { x: 50, y: -1 },
      { x: 50, y: 11 },
    ]);
    expect(store().notice).toMatch('fully crosses');

    store().select(null);
    expect(store().notice).toBeNull();
  });

  it('ignores editor actions without a document', () => {
    store().recolorSelection('#000000');
    store().resetSelectionColor();
    store().recolorGroup(0, '#000000');
    store().splitWithLine([]);

    expect(store().editor).toBeNull();
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
