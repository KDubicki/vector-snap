// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findShape } from '../editor/model';
import { DEFAULT_PRINT } from '../lib/printPlan';
import { presetJson } from '../lib/printPreset';
import { DEFAULT_TRACING } from '../lib/tracing';
import type { QuantizeResponse, VectorizeResponse } from '../types/api';
import { hasUnsavedEdits } from './editorSlice';
import {
  DEFAULT_COLORS,
  DEFAULT_MERGE_DELTA_E,
  DEFAULT_MIN_COVERAGE,
  DEFAULT_SMOOTH,
  reachableSteps,
  useAppStore,
} from './store';

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

  it('sends the smoothing strength and re-quantizes when it changes', async () => {
    store().selectFile(file);
    const fetchMock = respond(quantized);
    vi.stubGlobal('fetch', fetchMock);
    await store().runQuantize();

    store().setSmooth(3);
    await store().runQuantize();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const forms = fetchMock.mock.calls.map(([, init]) => (init as RequestInit).body as FormData);
    expect(forms.map((form) => form.get('smooth'))).toEqual([String(DEFAULT_SMOOTH), '3']);
  });

  it('merges colors under 2% by default and re-quantizes when the share changes', async () => {
    store().selectFile(file);
    const fetchMock = respond(quantized);
    vi.stubGlobal('fetch', fetchMock);
    await store().runQuantize();

    store().setMinCoverage(5);
    await store().runQuantize();
    store().setMinCoverage(0);
    await store().runQuantize();

    expect(DEFAULT_MIN_COVERAGE).toBe(2);
    const forms = fetchMock.mock.calls.map(([, init]) => (init as RequestInit).body as FormData);
    expect(forms.map((form) => form.get('min_coverage'))).toEqual(['0.02', '0.05', null]);
  });

  it('merges colors under ΔE00 2 by default and re-quantizes when the limit changes', async () => {
    store().selectFile(file);
    const fetchMock = respond(quantized);
    vi.stubGlobal('fetch', fetchMock);
    await store().runQuantize();

    store().setMergeDeltaE(5);
    await store().runQuantize();
    store().setMergeDeltaE(0);
    await store().runQuantize();

    expect(DEFAULT_MERGE_DELTA_E).toBe(2);
    const forms = fetchMock.mock.calls.map(([, init]) => (init as RequestInit).body as FormData);
    expect(forms.map((form) => form.get('merge_delta_e'))).toEqual(['2', '5', null]);
  });

  it('upscales small images by default and re-quantizes when turned off', async () => {
    store().selectFile(file);
    const fetchMock = respond(quantized);
    vi.stubGlobal('fetch', fetchMock);
    await store().runQuantize();

    store().setUpscale(false);
    await store().runQuantize();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const forms = fetchMock.mock.calls.map(([, init]) => (init as RequestInit).body as FormData);
    expect(forms.map((form) => form.get('upscale'))).toEqual(['true', 'false']);
  });

  it('chooses the palette from the available filaments', async () => {
    const fetch = respond(quantized);
    vi.stubGlobal('fetch', fetch);
    store().selectFile(file);
    store().setAlgorithm('filaments');
    store().setFilamentLibrary({ owned: ['#f7f7f5', '#1b1b1b'], custom: [] });

    await store().runQuantize();
    const form = fetch.mock.calls[0][1].body as FormData;
    expect(form.get('algorithm')).toBe('filaments');
    expect(JSON.parse(String(form.get('filaments')))).toEqual(['#f7f7f5', '#1b1b1b']);
    expect(JSON.parse(localStorage.getItem('vectorsnap.filament-library')!).owned).toHaveLength(2);

    await store().runQuantize(); // unchanged: no new request
    store().setFilamentLibrary({ owned: ['#f7f7f5'], custom: [] });
    await store().runQuantize();
    expect(fetch).toHaveBeenCalledTimes(2);

    store().setFilamentLibrary({ owned: [], custom: [] });
    await store().runQuantize();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(store().error).toMatch('Choose at least one filament');
  });

  it('remembers my projects in the browser, across images', () => {
    const projects = [{ name: 'Dog tag', preset: presetJson(DEFAULT_PRINT) }];
    store().setMyProjects(projects);

    expect(JSON.parse(localStorage.getItem('vectorsnap.my-projects')!)).toEqual(projects);
    store().reset();
    expect(store().myProjects).toEqual(projects);
  });

  it('locks colors up to the palette size and re-quantizes with them', async () => {
    store().selectFile(file);
    store().setColors(2);
    const fetchMock = respond(quantized);
    vi.stubGlobal('fetch', fetchMock);
    await store().runQuantize();

    store().lockColor('#FF0000');
    store().lockColor('#ff0000');
    store().lockColor('#00ff00');
    store().lockColor('#0000ff');
    expect(store().locked).toEqual(['#ff0000', '#00ff00']);

    await store().runQuantize();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const form = (fetchMock.mock.calls[1] as [string, RequestInit])[1].body as FormData;
    expect(form.get('locked_colors')).toBe('["#ff0000","#00ff00"]');
  });

  it('keeps the color count at least the number of locked colors', () => {
    store().setColors(3);
    store().lockColor('#ff0000');
    store().lockColor('#00ff00');

    store().setColors(1);
    expect(store().colors).toBe(2);
  });

  it('unlocks colors and ignores colors that are not locked', () => {
    store().lockColor('#ff0000');
    const locked = store().locked;

    store().unlockColor('#00FF00');
    expect(store().locked).toBe(locked);

    store().unlockColor('#FF0000');
    expect(store().locked).toEqual([]);
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

  it('applies the suggested color count, clamped to the limits and locked colors', async () => {
    useAppStore.setState({ limits: { min_colors: 2, max_colors: 64, max_upload_mb: 10 } });
    store().selectFile(file);
    const fetchMock = respond({ colors: 70, target_delta_e: 5, errors: [] });
    vi.stubGlobal('fetch', fetchMock);

    await store().suggestColors();

    expect((fetchMock.mock.calls[0] as [string])[0]).toBe('/api/v1/suggest-colors');
    expect(store().colors).toBe(64);
    expect(store().suggestedColors).toBe(64);
    expect(store().suggesting).toBe(false);

    store().setColors(3);
    store().lockColor('#ff0000');
    store().lockColor('#00ff00');
    store().lockColor('#0000ff');
    vi.stubGlobal('fetch', respond({ colors: 2, target_delta_e: 5, errors: [] }));
    await store().suggestColors();
    expect(store().colors).toBe(3);
  });

  it('reports suggestion errors and clears the suggestion for a new file', async () => {
    useAppStore.setState({ limits: { min_colors: 2, max_colors: 64, max_upload_mb: 10 } });
    store().selectFile(file);
    vi.stubGlobal(
      'fetch',
      respond({ error: { code: 'X', message: 'Too big', details: {} }, request_id: null }, 413),
    );

    await store().suggestColors();
    expect(store().error).toBe('Too big');
    expect(store().suggesting).toBe(false);

    vi.stubGlobal('fetch', respond({ colors: 5, target_delta_e: 5, errors: [] }));
    await store().suggestColors();
    expect(store().suggestedColors).toBe(5);

    store().selectFile(new File(['other'], 'other.png', { type: 'image/png' }));
    expect(store().suggestedColors).toBeNull();
  });

  it('keeps suggesting state when a suggestion is aborted and does nothing without a file', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new DOMException('aborted', 'AbortError'));
    vi.stubGlobal('fetch', fetchMock);

    await store().suggestColors();
    expect(fetchMock).not.toHaveBeenCalled();

    store().selectFile(file);
    await store().suggestColors();
    expect(store().error).toBeNull();
    expect(store().suggesting).toBe(true);
  });

  it('leaves colors out, keeping at least one, and sends them to vectorize', async () => {
    useAppStore.setState({ quantized });

    store().toggleTransparent(1);
    store().toggleTransparent(0); // would remove the last visible color
    expect(store().transparent).toEqual([1]);

    const fetchMock = respond(vectorized);
    vi.stubGlobal('fetch', fetchMock);
    await store().runVectorize();

    const form = (fetchMock.mock.calls[0] as [string, RequestInit])[1].body as FormData;
    expect(form.get('transparent')).toBe('[1]');

    store().toggleTransparent(1);
    expect(store().transparent).toEqual([]);
  });

  it('removes the background only where it reaches the border, through vectorize', async () => {
    useAppStore.setState({ quantized });

    store().setBackground(0);
    const fetchMock = respond(vectorized);
    vi.stubGlobal('fetch', fetchMock);
    await store().runVectorize();

    const form = (fetchMock.mock.calls[0] as [string, RequestInit])[1].body as FormData;
    expect(form.get('background')).toBe('[0]');
    expect(form.get('transparent')).toBeNull();
  });

  it('drops removed colors when the palette is quantized again', async () => {
    store().selectFile(file);
    useAppStore.setState({ transparent: [0], background: 1 });
    vi.stubGlobal('fetch', respond(quantized));

    await store().runQuantize();

    expect(store().transparent).toEqual([]);
    expect(store().background).toBeNull();
  });

  it('manages palette overrides', () => {
    store().setOverride(1, '#ABCDEF');
    store().setOverride(2, '#000000');
    store().resetOverride(2);

    expect(store().overrides).toEqual({ 1: '#abcdef' });

    store().resetOverrides();
    expect(store().overrides).toEqual({});
  });

  it('restores the default tracing options', () => {
    store().setTracing({ mode: 'polygon', path_precision: 4 });
    expect(store().tracing).toMatchObject({ mode: 'polygon', path_precision: 4 });

    store().resetTracing();
    expect(store().tracing).toEqual(DEFAULT_TRACING);
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

  it('selects shapes smaller than an area or explains that there are none', async () => {
    useAppStore.setState({ quantized });
    vi.stubGlobal('fetch', respond(vectorized));
    await store().runVectorize();

    store().selectSmallerThan(10);
    expect(store().selection).toEqual([]);
    expect(store().notice).toBe('No shapes are smaller than 10 px².');

    store().selectSmallerThan(60); // both triangles have 50 px²
    expect(store().selection).toEqual(['p-0-0', 'p-0-1']);
    expect(store().notice).toBeNull();
  });

  it('selects many shapes at once and everything', async () => {
    useAppStore.setState({ quantized });
    vi.stubGlobal('fetch', respond(vectorized));
    await store().runVectorize();

    store().selectMany(['p-0-1', 'missing']);
    expect(store().selection).toEqual(['p-0-1']);

    store().selectMany(['p-0-0', 'p-0-1'], true);
    expect(store().selection).toEqual(['p-0-1', 'p-0-0']);

    store().selectMany([]);
    expect(store().selection).toEqual([]);

    store().selectAll();
    expect(store().selection).toEqual(['p-0-0', 'p-0-1']);
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

  it('cuts a lasso region out of the start shape or the selection', async () => {
    useAppStore.setState({ quantized });
    vi.stubGlobal('fetch', respond(vectorized));
    await store().runVectorize();
    // left half of triangle p-0-0 (0,0) (10,0) (10,10)
    const region = [
      { x: -1, y: -1 },
      { x: 5, y: -1 },
      { x: 5, y: 11 },
      { x: -1, y: 11 },
    ];

    store().cutWithLasso(region, null);
    expect(store().notice).toMatch('Start the lasso on a shape');

    store().cutWithLasso(region, 'p-0-1');
    expect(store().notice).toMatch('part of the shape');

    store().cutWithLasso(region, 'p-0-0');
    expect(store().selection).toEqual(['p-0-0.a']);
    expect(store().editor?.groups[0].shapes.map((s) => s.id)).toEqual([
      'p-0-0.a',
      'p-0-0.b',
      'p-0-1',
    ]);

    store().undo();
    store().select('p-0-0');
    store().cutWithLasso(region, 'p-0-1'); // the selection wins over the start shape
    expect(store().selection).toEqual(['p-0-0.a']);
  });

  it('moves and transforms the selection; nudges are one undo step', async () => {
    useAppStore.setState({ quantized });
    vi.stubGlobal('fetch', respond(vectorized));
    await store().runVectorize();
    const first = () => store().editor!.groups[0].shapes[0].d;
    const original = first();

    store().moveSelection(5, 0);
    expect(store().history.past).toHaveLength(0); // nothing selected

    store().select('p-0-0');
    store().moveSelection(1, 0);
    store().moveSelection(1, 0);
    expect(first()).not.toBe(original);
    expect(store().history.past).toHaveLength(1);
    store().undo();
    expect(first()).toBe(original);

    store().transformSelection('flip-x');
    expect(first()).not.toBe(original);
    expect(store().editor!.groups[0].shapes[1].d).toBe('M10,0 L20,0 L20,10 Z');
  });

  it('saves, renames and deletes fragments, kept after starting over', async () => {
    useAppStore.setState({ quantized, fragments: [] });
    vi.stubGlobal('fetch', respond(vectorized));
    await store().runVectorize();

    expect(store().saveFragment()).toBeNull(); // nothing selected
    store().select('p-0-1');
    const saved = store().saveFragment('  ');
    expect(saved).toMatchObject({ name: 'Fragment 1', width: 10, height: 10 });
    expect(saved!.shapes).toEqual([{ d: 'M0,0h10v10z', fill: '#ff0000' }]);
    expect(store().fragmentsStored).toBe(true);

    store().saveFragment('Corner');
    expect(store().fragments.map((f) => f.name)).toEqual(['Corner', 'Fragment 1']);
    store().renameFragment(saved!.id, 'Triangle');
    store().renameFragment(saved!.id, ' ');
    expect(store().fragments[1].name).toBe('Triangle');
    expect(JSON.parse(localStorage.getItem('vectorsnap.fragments')!)).toHaveLength(2);

    expect(store().importFragments([saved!])).toBe(0);
    expect(store().importFragments([{ ...saved!, id: 'imported' }])).toBe(1);
    expect(store().fragments[0].id).toBe('imported');
    store().deleteFragment('imported');

    const triangle = store().fragments.find((f) => f.id === saved!.id)!;
    store().placeFragment(triangle, { matchColors: false });
    expect(store().selection).toEqual(['frag-1-0']);
    expect(store().notice).toMatch('Placed “Triangle”');
    expect(store().editor!.groups.at(-1)).toMatchObject({ paletteIndex: 1, fill: '#ff0000' });
    store().undo();
    expect(store().editor!.groups).toHaveLength(1);

    store().reset();
    store().deleteFragment(store().fragments[0].id);
    expect(store().fragments.map((f) => f.name)).toEqual(['Triangle']);
    store().deleteFragment(saved!.id);
    expect(localStorage.getItem('vectorsnap.fragments')).toBeNull();
  });

  it('merges the selection into the largest shape', async () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 10">' +
      '<g data-palette-index="0" fill="#ff0000"><path id="small" d="M0,0 L5,0 L5,10 L0,10 Z"/></g>' +
      '<g data-palette-index="1" fill="#0000ff"><path id="big" d="M5,0 L20,0 L20,10 L5,10 Z" fill="#00ff00"/>' +
      '<path id="other" d="M25,0 L30,0 L30,10 L25,10 Z"/></g></svg>';
    useAppStore.setState({ quantized });
    vi.stubGlobal('fetch', respond({ ...vectorized, svg }));
    await store().runVectorize();

    store().select('small');
    store().mergeSelection();
    expect(store().notice).toMatch('at least two');

    store().selectMany(['small', 'big']);
    store().mergeSelection();

    const doc = store().editor!;
    expect(doc.groups.map((g) => g.paletteIndex)).toEqual([1]);
    expect(doc.groups[0].shapes.map((s) => [s.id, s.fill])).toEqual([
      ['big', '#00ff00'],
      ['other', undefined],
    ]);
    expect(store().selection).toEqual(['big']);
  });

  it('moves the selection into another color group', async () => {
    useAppStore.setState({ quantized });
    const svg = vectorized.svg.replace(
      '</svg>',
      '<g data-palette-index="1" fill="#0000ff"><path id="p-1-0" d="M0,0 L1,1 Z"/></g></svg>',
    );
    vi.stubGlobal('fetch', respond({ ...vectorized, svg }));
    await store().runVectorize();

    store().moveSelectionToGroup(1); // nothing selected
    expect(store().history.past).toHaveLength(0);

    store().select('p-0-0');
    store().recolorSelection('#00ff00');
    store().moveSelectionToGroup(1);

    const doc = store().editor!;
    expect(doc.groups[1].shapes.map((s) => [s.id, s.fill])).toEqual([
      ['p-1-0', undefined],
      ['p-0-0', undefined],
    ]);
    expect(store().selection).toEqual(['p-0-0']);
  });

  it('gives the selection the color of a clicked shape (eyedropper)', async () => {
    useAppStore.setState({ quantized });
    const svg = vectorized.svg.replace(
      '</svg>',
      '<g data-palette-index="1" fill="#0000ff"><path id="p-1-0" d="M0,0 L1,1 Z"/></g></svg>',
    );
    vi.stubGlobal('fetch', respond({ ...vectorized, svg }));
    await store().runVectorize();

    store().matchSelectionColor('p-1-0'); // nothing selected
    expect(store().notice).toMatch(/Select the shapes to recolor first/);
    expect(store().history.past).toHaveLength(0);

    store().select('p-0-0');
    store().matchSelectionColor(null); // clicked beside the design
    expect(store().history.past).toHaveLength(0);
    store().matchSelectionColor('p-1-0');
    expect(findShape(store().editor!, 'p-0-0')!.group.paletteIndex).toBe(1);
    expect(store().history.past).toHaveLength(1);

    store().matchSelectionColor('p-1-0');
    expect(store().notice).toBe('The selected shapes already have this color.');
    expect(store().history.past).toHaveLength(1);
  });

  it('deletes the selection and supports undo/redo of every edit', async () => {
    useAppStore.setState({ quantized });
    vi.stubGlobal('fetch', respond(vectorized));
    await store().runVectorize();
    const original = store().editor;

    store().select('p-0-0');
    store().recolorSelection('#00ff00');
    store().deleteSelection();
    expect(store().editor?.groups[0].shapes.map((s) => s.id)).toEqual(['p-0-1']);
    expect(store().selection).toEqual([]);

    store().undo();
    expect(store().editor?.groups[0].shapes[0]).toMatchObject({ id: 'p-0-0', fill: '#00ff00' });

    store().select('p-0-0');
    store().undo();
    expect(store().editor).toBe(original);
    expect(store().selection).toEqual(['p-0-0']);

    store().undo(); // nothing left
    expect(store().editor).toBe(original);

    store().redo();
    store().redo();
    expect(store().editor?.groups[0].shapes.map((s) => s.id)).toEqual(['p-0-1']);
    expect(store().selection).toEqual([]);

    store().redo(); // nothing left
    expect(store().editor?.groups[0].shapes).toHaveLength(1);
  });

  it('tracks edits that have not been downloaded', async () => {
    useAppStore.setState({ quantized });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => respond(vectorized)()),
    );
    await store().runVectorize();
    expect(hasUnsavedEdits(store())).toBe(false);

    store().select('p-0-0');
    store().deleteSelection();
    expect(hasUnsavedEdits(store())).toBe(true);

    store().markSaved();
    expect(hasUnsavedEdits(store())).toBe(false);

    store().undo(); // back to the converted document: nothing to lose
    expect(hasUnsavedEdits(store())).toBe(false);
    store().redo(); // the downloaded version again
    expect(hasUnsavedEdits(store())).toBe(false);

    store().select('p-0-1');
    store().deleteSelection();
    expect(hasUnsavedEdits(store())).toBe(true);
    await store().runVectorize(); // a new conversion starts clean
    expect(hasUnsavedEdits(store())).toBe(false);
  });

  it('merges rapid recolors of the same target into one undo step', async () => {
    useAppStore.setState({ quantized });
    vi.stubGlobal('fetch', respond(vectorized));
    await store().runVectorize();
    const original = store().editor;

    store().recolorGroup(0, '#111111');
    store().recolorGroup(0, '#222222');
    store().recolorGroup(0, '#333333');
    expect(store().history.past).toHaveLength(1);

    store().undo();
    expect(store().editor).toBe(original);
  });

  it('does not record history for edits that change nothing', async () => {
    useAppStore.setState({ quantized });
    vi.stubGlobal('fetch', respond(vectorized));
    await store().runVectorize();

    store().deleteSelection();
    store().recolorSelection('#000000');

    expect(store().history.past).toHaveLength(0);
  });

  it('ignores editor actions without a document', () => {
    store().recolorSelection('#000000');
    store().resetSelectionColor();
    store().recolorGroup(0, '#000000');
    store().splitWithLine([]);
    store().deleteSelection();
    store().undo();
    store().redo();
    store().selectMany(['x']);
    store().cutWithLasso([], 'x');
    store().mergeSelection();
    store().moveSelectionToGroup(0);
    store().mergeSimilarColors(2);
    store().selectAll();

    expect(store().editor).toBeNull();
    expect(store().selection).toEqual([]);
  });

  it('only opens steps that are reachable', async () => {
    expect(reachableSteps(store())).toEqual(['upload']);
    store().goTo('result');
    expect(store().step).toBe('upload');

    store().selectFile(file);
    expect(reachableSteps(store())).toEqual(['upload', 'palette']);

    useAppStore.setState({ quantized });
    vi.stubGlobal('fetch', respond(vectorized));
    await store().runVectorize();
    expect(reachableSteps(store())).toEqual(['upload', 'palette', 'result', 'print']);

    store().goTo('upload');
    store().goTo('result');
    expect(store().step).toBe('result');
  });

  it('opens the 3D print step once there is an SVG', async () => {
    store().selectFile(file);
    store().goTo('print');
    expect(store().step).toBe('palette');

    useAppStore.setState({ quantized });
    vi.stubGlobal('fetch', respond(vectorized));
    await store().runVectorize();
    store().goTo('print');
    expect(store().step).toBe('print');
  });

  it('keeps the project for design edits and turns custom on other changes', () => {
    store().chooseProject('keychain');
    expect(store().print).toMatchObject({ project: 'keychain', loopHoleMm: 4 });

    store().setPrint({ shapeRaise: { 'p-0-0': 2 }, excluded: [1] });
    store().setPrint({ style: 'mixed', filaments: [{ color: '#ffffff', td: 3 }] });
    expect(store().print.project).toBe('keychain');

    store().setPrint({ widthMm: 50 });
    expect(store().print).toMatchObject({ project: 'custom', widthMm: 50, loopHoleMm: 4 });
  });

  it('remembers the printer for the next designs and keeps it across projects', () => {
    store().chooseProject('keychain');
    store().setPrint({ nozzleMm: 0.6, colorGapMm: 0.1 });
    expect(store().print.project).toBe('keychain');
    store().chooseProject('magnet');
    expect(store().print.nozzleMm).toBe(0.6);
    expect(JSON.parse(localStorage.getItem('vectorsnap.printer')!)).toMatchObject({
      nozzleMm: 0.6,
      colorGapMm: 0.1,
    });

    store().reset();
    expect(store().print).toMatchObject({ project: 'custom', nozzleMm: 0.6, colorGapMm: 0.1 });

    // Design settings are not remembered.
    localStorage.clear();
    store().setPrint({ widthMm: 50 });
    expect(localStorage.getItem('vectorsnap.printer')).toBeNull();
  });

  it('fits nozzle and layer height to the chosen printer', () => {
    store().setPrint({ nozzleMm: 0.5 });
    store().setPrint({ printer: 'kobra-x' });
    expect(store().print).toMatchObject({ printer: 'kobra-x', nozzleMm: 0.4, layerMm: 0.2 });

    store().setPrint({ nozzleMm: 0.25 });
    expect(store().print).toMatchObject({ nozzleMm: 0.25, layerMm: 0.1, baseLayers: 16 });

    // Projects set 0.2 mm layers, too thick for the 0.25 nozzle.
    store().chooseProject('keychain');
    expect(store().print).toMatchObject({ project: 'keychain', layerMm: 0.1, baseLayers: 20 });

    store().reset();
    expect(store().print).toMatchObject({ printer: 'kobra-x', nozzleMm: 0.25, layerMm: 0.1 });
  });

  it('loads print settings with their project and remembers their printer', () => {
    store().loadPrintSettings(
      {
        project: 'coaster',
        printer: 'kobra-x',
        nozzleMm: 0.6,
        widthMm: 90,
      },
      'sign.print.json',
    );

    // 0.2 mm layers suit the 0.6 nozzle; the project stays even with a changed width.
    expect(store().print).toMatchObject({ project: 'coaster', widthMm: 90, layerMm: 0.2 });
    expect(JSON.parse(localStorage.getItem('vectorsnap.printer')!)).toMatchObject({
      printer: 'kobra-x',
      nozzleMm: 0.6,
    });
  });

  it('undoes the last project or settings file, until the next change', () => {
    store().setPrint({ widthMm: 50, loopHoleMm: 0 });
    store().chooseProject('keychain');
    expect(store().printUndo?.what).toBe('Keychain');
    store().undoPrintChange();
    expect(store().print).toMatchObject({ project: 'custom', widthMm: 50, loopHoleMm: 0 });
    expect(store().printUndo).toBeNull();

    store().loadPrintSettings({ widthMm: 120 }, 'sign.print.json');
    expect(store().printUndo?.what).toBe('sign.print.json');
    store().setPrint({ marginMm: 3 }); // a later change would be undone too: no undo
    expect(store().printUndo).toBeNull();

    store().chooseProject('custom'); // changes nothing
    expect(store().printUndo).toBeNull();
  });

  it('resets colors and raised elements for a new SVG but keeps the project', async () => {
    store().chooseProject('magnet');
    store().setPrint({ shapeRaise: { 'p-0-0': 2 }, colorRaise: { 0: 1 }, excluded: [1] });
    useAppStore.setState({ quantized });
    vi.stubGlobal('fetch', respond(vectorized));

    await store().runVectorize();

    expect(store().print).toMatchObject({
      project: 'magnet',
      shapeRaise: {},
      colorRaise: {},
      excluded: [],
    });
  });

  it('navigates and resets', () => {
    store().selectFile(file);
    store().setColors(12);
    store().setAlgorithm('median_cut');
    store().setSmooth(0);
    store().setUpscale(false);
    store().goTo('upload');
    expect(store().step).toBe('upload');

    store().reset();
    expect(store().file).toBeNull();
    expect(store().colors).toBe(DEFAULT_COLORS);
    expect(store().algorithm).toBe('kmeans');
    expect(store().smooth).toBe(DEFAULT_SMOOTH);
    expect(store().upscale).toBe(true);
  });
});
