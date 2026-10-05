import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, exportFile, getLimits, quantize, vectorize } from './client';

function mockFetch(response: Response) {
  const fetchMock = vi.fn().mockResolvedValue(response);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
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

    await quantize(new Blob(['img']), { colors: 8, algorithm: 'median_cut' });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const form = init.body as FormData;
    expect(url).toBe('/api/v1/quantize');
    expect(init.method).toBe('POST');
    expect(form.get('colors')).toBe('8');
    expect(form.get('algorithm')).toBe('median_cut');
  });

  it('omits the algorithm when not provided', async () => {
    const fetchMock = mockFetch(jsonResponse({ palette: [] }));

    await quantize(new Blob(['img']), { colors: 4 });

    const form = (fetchMock.mock.calls[0] as [string, RequestInit])[1].body as FormData;
    expect(form.has('algorithm')).toBe(false);
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
});
