import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  BUSY_RETRIES,
  errorMessage,
  exportFile,
  exportLithophane,
  getFilamentPlan,
  getLimits,
  quantize,
  retryAfterSeconds,
  suggestColors,
  vectorize,
} from './client';

function mockFetch(response: Response) {
  const fetchMock = vi.fn().mockResolvedValue(response);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

function busy(retryAfter = '5') {
  return new Response(
    JSON.stringify({
      error: { code: 'SERVER_BUSY', message: 'The server is busy.', details: {} },
      request_id: 'r',
    }),
    { status: 503, headers: { 'Retry-After': retryAfter } },
  );
}

describe('api client', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches limits from the versioned API', async () => {
    const limits = { min_colors: 2, max_colors: 64 };
    const fetchMock = mockFetch(jsonResponse(limits));

    await expect(getLimits()).resolves.toEqual(limits);
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/limits', expect.anything());
  });

  it('sends quantize parameters as multipart form data', async () => {
    const fetchMock = mockFetch(jsonResponse({ palette: [] }));

    await quantize(new Blob(['img']), {
      colors: 8,
      algorithm: 'median_cut',
      smooth: 0,
      upscale: true,
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const form = init.body as FormData;
    expect(url).toBe('/api/v1/quantize');
    expect(init.method).toBe('POST');
    expect(form.get('colors')).toBe('8');
    expect(form.get('algorithm')).toBe('median_cut');
    expect(form.get('smooth')).toBe('0');
    expect(form.get('upscale')).toBe('true');
  });

  it('omits the algorithm, smoothing and upscaling when not provided', async () => {
    const fetchMock = mockFetch(jsonResponse({ palette: [] }));

    await quantize(new Blob(['img']), { colors: 4 });

    const form = (fetchMock.mock.calls[0] as [string, RequestInit])[1].body as FormData;
    expect(form.has('algorithm')).toBe(false);
    expect(form.has('smooth')).toBe(false);
    expect(form.has('upscale')).toBe(false);
  });

  it('sends locked colors as a JSON array only when there are any', async () => {
    const fetchMock = vi.fn().mockImplementation(() => jsonResponse({ palette: [] }));
    vi.stubGlobal('fetch', fetchMock);

    await quantize(new Blob(['img']), { colors: 4, locked_colors: ['#ff0000'] });
    await quantize(new Blob(['img']), { colors: 4, locked_colors: [] });

    const form = (call: number) =>
      (fetchMock.mock.calls[call] as [string, RequestInit])[1].body as FormData;
    expect(form(0).get('locked_colors')).toBe('["#ff0000"]');
    expect(form(1).has('locked_colors')).toBe(false);
  });

  it('posts the image to get a color count suggestion', async () => {
    const fetchMock = mockFetch(jsonResponse({ colors: 6, target_delta_e: 5, errors: [] }));
    const image = new Blob(['img']);

    const suggestion = await suggestColors(image);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/v1/suggest-colors');
    expect((init.body as FormData).get('image')).toBeInstanceOf(Blob);
    expect(suggestion.colors).toBe(6);
  });

  it('sends palette as JSON and tracing options as fields', async () => {
    const fetchMock = mockFetch(jsonResponse({ svg: '<svg/>' }));

    await vectorize(new Blob(['png']), ['#000000', '#ffffff'], {
      mode: 'polygon',
      filter_speckle: 2,
    });

    const form = (fetchMock.mock.calls[0] as [string, RequestInit])[1].body as FormData;
    expect(form.get('palette')).toBe('["#000000","#ffffff"]');
    expect(form.get('mode')).toBe('polygon');
    expect(form.get('filter_speckle')).toBe('2');
    expect(form.has('transparent')).toBe(false);
  });

  it('sends removed colors as a JSON array of palette indices', async () => {
    const fetchMock = mockFetch(jsonResponse({ svg: '<svg/>' }));

    await vectorize(new Blob(['png']), ['#000000', '#ffffff'], { transparent: [1] });

    const form = (fetchMock.mock.calls[0] as [string, RequestInit])[1].body as FormData;
    expect(form.get('transparent')).toBe('[1]');
    expect(form.has('undefined')).toBe(false);
  });

  it('exports an svg with options and returns the file', async () => {
    const fetchMock = mockFetch(new Response(new Blob(['solid']), { status: 200 }));

    const blob = await exportFile('stl', '<svg/>', { width_mm: 50, layered: true });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const form = init.body as FormData;
    expect(url).toBe('/api/v1/export/stl');
    expect(await (form.get('svg') as Blob).text()).toBe('<svg/>');
    expect(form.get('width_mm')).toBe('50');
    expect(form.get('layered')).toBe('true');
    expect(await blob.text()).toBe('solid');
  });

  it('sends the original image for a lithophane', async () => {
    const fetchMock = mockFetch(new Response(new Blob(['solid']), { status: 200 }));
    const image = new Blob(['png'], { type: 'image/png' });

    const blob = await exportLithophane(image, { width_mm: 80, invert: false });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const form = init.body as FormData;
    expect(url).toBe('/api/v1/export/lithophane');
    expect(await (form.get('image') as Blob).text()).toBe('png');
    expect(form.get('width_mm')).toBe('80');
    expect(form.get('invert')).toBe('false');
    expect(await blob.text()).toBe('solid');
  });

  it('maps lithophane errors to ApiError', async () => {
    mockFetch(
      jsonResponse(
        { error: { code: 'INVALID_PARAMETERS', message: 'Too big', details: {} }, request_id: 'r' },
        422,
      ),
    );

    await expect(exportLithophane(new Blob(['x']), {})).rejects.toMatchObject({
      code: 'INVALID_PARAMETERS',
      message: 'Too big',
    });
  });

  it('maps export errors to ApiError', async () => {
    mockFetch(
      jsonResponse(
        { error: { code: 'INVALID_SVG', message: 'Bad SVG', details: {} }, request_id: 'r' },
        422,
      ),
    );

    await expect(exportFile('stl', 'x', {})).rejects.toMatchObject({ code: 'INVALID_SVG' });
  });

  it('maps the backend error envelope to ApiError', async () => {
    mockFetch(
      jsonResponse(
        {
          error: { code: 'FILE_TOO_LARGE', message: 'Too big', details: {} },
          request_id: 'req-1',
        },
        413,
      ),
    );

    const error = await getLimits().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 413, code: 'FILE_TOO_LARGE', requestId: 'req-1' });
  });

  it('falls back to HTTP status when the error body is not JSON', async () => {
    mockFetch(
      new Response('Bad Gateway', {
        status: 502,
        statusText: 'Bad Gateway',
        headers: { 'X-Request-ID': 'req-2' },
      }),
    );

    const error = await getLimits().catch((e: unknown) => e);

    expect(error).toMatchObject({
      status: 502,
      code: 'UNKNOWN_ERROR',
      message: 'Bad Gateway',
      requestId: 'req-2',
    });
  });

  it('requests the filament plan with the 3d export options', async () => {
    const plan = { steps: [], conflicts: [], height_mm: 0 };
    const fetchMock = mockFetch(jsonResponse(plan));

    const result = await getFilamentPlan('<svg/>', { base_mm: 0.6, layered: true });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const form = init.body as FormData;
    expect(url).toBe('/api/v1/export/filament-plan');
    expect(form.get('svg')).toBeInstanceOf(Blob);
    expect(form.get('base_mm')).toBe('0.6');
    expect(form.get('layered')).toBe('true');
    expect(result).toEqual(plan);
  });

  describe('when the server is busy', () => {
    afterEach(() => vi.useRealTimers());

    it('waits the Retry-After it asks for and tries again', async () => {
      vi.useFakeTimers();
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(busy('3'))
        .mockResolvedValueOnce(busy())
        .mockResolvedValueOnce(jsonResponse({ colors: 5, target_delta_e: 5, errors: [] }));
      vi.stubGlobal('fetch', fetchMock);

      const suggestion = suggestColors(new Blob(['img']));
      await vi.advanceTimersByTimeAsync(2999);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(5000);

      await expect(suggestion).resolves.toMatchObject({ colors: 5 });
      expect(fetchMock).toHaveBeenCalledTimes(3);
      // The same form goes again.
      expect(fetchMock.mock.calls[2][1]).toBe(fetchMock.mock.calls[0][1]);
    });

    it('gives up with the backend error after the last retry', async () => {
      vi.useFakeTimers();
      const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(busy()));
      vi.stubGlobal('fetch', fetchMock);

      const result = exportFile('stl', '<svg/>', {}).catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(BUSY_RETRIES * 5000);

      expect(await result).toMatchObject({ status: 503, code: 'SERVER_BUSY' });
      expect(fetchMock).toHaveBeenCalledTimes(BUSY_RETRIES + 1);
    });

    it('stops waiting when the request is aborted', async () => {
      vi.useFakeTimers();
      const fetchMock = vi.fn().mockResolvedValue(busy('30'));
      vi.stubGlobal('fetch', fetchMock);
      const controller = new AbortController();

      const result = getLimits(controller.signal).catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(1000);
      controller.abort();

      expect(await result).toMatchObject({ name: 'AbortError' });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('does not retry other 503 answers', async () => {
      const fetchMock = mockFetch(new Response('Service Unavailable', { status: 503 }));

      await expect(getLimits()).rejects.toMatchObject({ status: 503 });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('reads Retry-After in seconds or as a date, within 1–30 s', () => {
      const now = Date.parse('2026-11-06T12:00:00Z');
      expect(retryAfterSeconds('7', now)).toBe(7);
      expect(retryAfterSeconds('0', now)).toBe(1);
      expect(retryAfterSeconds('3600', now)).toBe(30);
      expect(retryAfterSeconds('Fri, 06 Nov 2026 12:00:12 GMT', now)).toBe(12);
      expect(retryAfterSeconds('soon', now)).toBe(5);
      expect(retryAfterSeconds(null, now)).toBe(5);
    });
  });

  it('turns errors into messages with a fallback', () => {
    expect(errorMessage(new ApiError(422, 'INVALID_SVG', 'Bad SVG', null))).toBe('Bad SVG');
    expect(errorMessage(new Error('offline'), 'Export failed')).toBe('offline');
    expect(errorMessage('boom', 'Export failed')).toBe('Export failed');
    expect(errorMessage(undefined)).toBe('Unexpected error');
  });
});
