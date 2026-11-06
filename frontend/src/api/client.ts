import type {
  ColorChanges,
  ApiErrorBody,
  ColorSuggestion,
  FilamentPlan,
  Limits,
  ModelSize,
  PrintCheck,
  QuantizeParams,
  QuantizeResponse,
  SvgSimplifyResponse,
  TracingOptions,
  VectorizeResponse,
} from '../types/api';

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '/api';
/** Where the API lives, relative to the page unless configured. */
export const API_BASE_URL: string = BASE_URL;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly requestId: string | null,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** No answer came at all: offline, or the server is down or refused the connection. */
export const UNREACHABLE_MESSAGE =
  'Cannot reach the VectorSnap server. Check your connection and try again.';

/** Whether no answer came from the backend itself (no network, or a proxy's 502–504). */
export function isUnreachable(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    (error.code === 'NETWORK_ERROR' || error.code === 'SERVER_UNAVAILABLE')
  );
}

/**
 * Message to show for a failed request (`ApiError` carries the backend's message). An
 * unexpected server error (500) adds its request id, which its message asks to quote
 * and which finds it in the backend's log.
 */
export function errorMessage(error: unknown, fallback = 'Unexpected error'): string {
  if (error instanceof ApiError && error.status === 500 && error.requestId) {
    return `${error.message} Request id: ${error.requestId}`;
  }
  return error instanceof Error ? error.message : fallback;
}

// A proxy in front of the backend (nginx, Vite) answers these itself, without the error
// envelope, when the backend is down, restarting or too slow.
const GATEWAY_STATUSES = [502, 503, 504];

function statusMessage(response: Response): string {
  const status = `${response.status}${response.statusText ? ` ${response.statusText}` : ''}`;
  return GATEWAY_STATUSES.includes(response.status)
    ? `The VectorSnap server is not responding (${status}). Try again in a moment.`
    : `The request failed (${status}).`;
}

async function toApiError(response: Response): Promise<ApiError> {
  const body = (await response.json().catch(() => null)) as ApiErrorBody | null;
  const gateway = !body?.error && GATEWAY_STATUSES.includes(response.status);
  return new ApiError(
    response.status,
    body?.error.code ?? (gateway ? 'SERVER_UNAVAILABLE' : 'UNKNOWN_ERROR'),
    body?.error.message ?? statusMessage(response),
    body?.request_id ?? response.headers.get('X-Request-ID'),
  );
}

/**
 * Times a request is sent again after `503 SERVER_BUSY`: every processing slot of the
 * backend was taken and its queue timed out (docs/05-api-specification.md#overview).
 */
export const BUSY_RETRIES = 2;
/** Wait before a retry when the answer has no usable `Retry-After`, and the longest one. */
const DEFAULT_RETRY_AFTER_S = 5;
const MAX_RETRY_AFTER_S = 30;

/** Seconds `Retry-After` asks for (seconds or an HTTP date), within 1–30. */
export function retryAfterSeconds(header: string | null, now = Date.now()): number {
  if (!header) return DEFAULT_RETRY_AFTER_S;
  const seconds = /^\d+$/.test(header.trim()) ? Number(header) : (Date.parse(header) - now) / 1000;
  if (Number.isNaN(seconds)) return DEFAULT_RETRY_AFTER_S;
  return Math.min(Math.max(seconds, 1), MAX_RETRY_AFTER_S);
}

function wait(seconds: number, signal?: AbortSignal | null): Promise<void> {
  return new Promise((resolve, reject) => {
    const aborted = () => reject(new DOMException('The request was aborted.', 'AbortError'));
    if (signal?.aborted) return aborted();
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, seconds * 1000);
    const onAbort = () => {
      clearTimeout(timer);
      aborted();
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function isServerBusy(response: Response): Promise<boolean> {
  if (response.status !== 503) return false;
  const body = (await response
    .clone()
    .json()
    .catch(() => null)) as ApiErrorBody | null;
  return body?.error.code === 'SERVER_BUSY';
}

/**
 * `fetch`, sent again up to `BUSY_RETRIES` times while the backend answers `503
 * SERVER_BUSY`, after the `Retry-After` it gives: a moment of heavy load then costs a
 * wait instead of an error. Aborting the signal stops the wait too.
 */
async function send(url: string, init?: RequestInit): Promise<Response> {
  for (let retry = 0; ; retry += 1) {
    let response: Response;
    try {
      response = await fetch(url, init);
    } catch (error) {
      // fetch rejects (a TypeError: "Failed to fetch", "Load failed") when no answer came
      // at all; its message says nothing to people. An abort stays an abort.
      if ((error as { name?: unknown } | null)?.name === 'AbortError') throw error;
      throw new ApiError(0, 'NETWORK_ERROR', UNREACHABLE_MESSAGE, null);
    }
    if (retry === BUSY_RETRIES || !(await isServerBusy(response))) return response;
    await wait(retryAfterSeconds(response.headers.get('Retry-After')), init?.signal);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await send(`${BASE_URL}/v1${path}`, init);
  if (!response.ok) throw await toApiError(response);
  return (await response.json()) as T;
}

/** Convert an SVG (VectorSnap contract) to another format on the backend. */
export async function exportFile(
  format: string,
  svg: string,
  options: Record<string, string | number | boolean>,
  signal?: AbortSignal,
): Promise<Blob> {
  const form = exportForm(svg, options);
  const response = await send(`${BASE_URL}/v1/export/${format}`, {
    method: 'POST',
    body: form,
    signal,
  });
  if (!response.ok) throw await toApiError(response);
  return response.blob();
}

/** Lithophane STL built from the original image (`POST /export/lithophane`). */
export async function exportLithophane(
  image: Blob,
  options: Record<string, string | number | boolean>,
  signal?: AbortSignal,
): Promise<Blob> {
  const form = new FormData();
  form.append('image', image);
  for (const [key, value] of Object.entries(options)) form.append(key, String(value));
  const response = await send(`${BASE_URL}/v1/export/lithophane`, {
    method: 'POST',
    body: form,
    signal,
  });
  if (!response.ok) throw await toApiError(response);
  return response.blob();
}

function exportForm(svg: string, options: Record<string, string | number | boolean>): FormData {
  const form = new FormData();
  form.append('svg', new Blob([svg], { type: 'image/svg+xml' }), 'document.svg');
  for (const [key, value] of Object.entries(options)) form.append(key, String(value));
  return form;
}

/** Outlines of `ids` (every shape without) with fewer points, within `tolerance` px. */
export function simplifySvg(
  svg: string,
  tolerance: number,
  ids: string[],
  signal?: AbortSignal,
): Promise<SvgSimplifyResponse> {
  return request<SvgSimplifyResponse>('/svg/simplify', {
    method: 'POST',
    body: exportForm(svg, { tolerance, ids: JSON.stringify(ids) }),
    signal,
  });
}

/** Where to change filament when printing the 3D export (same options as STL/3MF). */
export function getFilamentPlan(
  svg: string,
  options: Record<string, string | number | boolean>,
  signal?: AbortSignal,
): Promise<FilamentPlan> {
  return request<FilamentPlan>('/export/filament-plan', {
    method: 'POST',
    body: exportForm(svg, options),
    signal,
  });
}

/** Size of the 3D model for the STL/3MF options, base plate and loop included. */
export function getModelSize(
  svg: string,
  options: Record<string, string | number | boolean>,
  signal?: AbortSignal,
): Promise<ModelSize> {
  return request<ModelSize>('/export/model-size', {
    method: 'POST',
    body: exportForm(svg, options),
    signal,
  });
}

/** Shapes narrower than `nozzle_mm` where they print, for the STL/3MF options. */
export function getPrintCheck(
  svg: string,
  options: Record<string, string | number | boolean>,
  signal?: AbortSignal,
): Promise<PrintCheck> {
  return request<PrintCheck>('/export/print-check', {
    method: 'POST',
    body: exportForm(svg, options),
    signal,
  });
}

/** Filament changes, their time and purge for the STL/3MF options (needs print_layer_mm). */
export function getColorChanges(
  svg: string,
  options: Record<string, string | number | boolean>,
  signal?: AbortSignal,
): Promise<ColorChanges> {
  return request<ColorChanges>('/export/color-changes', {
    method: 'POST',
    body: exportForm(svg, options),
    signal,
  });
}

export function getLimits(signal?: AbortSignal): Promise<Limits> {
  return request<Limits>('/limits', { signal });
}

export function quantize(
  image: Blob,
  params: QuantizeParams,
  signal?: AbortSignal,
): Promise<QuantizeResponse> {
  const form = new FormData();
  form.append('image', image);
  form.append('colors', String(params.colors));
  if (params.algorithm) form.append('algorithm', params.algorithm);
  if (params.locked_colors?.length) {
    form.append('locked_colors', JSON.stringify(params.locked_colors));
  }
  if (params.smooth !== undefined) form.append('smooth', String(params.smooth));
  if (params.upscale !== undefined) form.append('upscale', String(params.upscale));
  if (params.filaments?.length) form.append('filaments', JSON.stringify(params.filaments));
  if (params.min_coverage) form.append('min_coverage', String(params.min_coverage));
  if (params.merge_delta_e) form.append('merge_delta_e', String(params.merge_delta_e));
  return request<QuantizeResponse>('/quantize', { method: 'POST', body: form, signal });
}

/** Ask the backend how many colors represent the image well. */
export function suggestColors(image: Blob, signal?: AbortSignal): Promise<ColorSuggestion> {
  const form = new FormData();
  form.append('image', image);
  return request<ColorSuggestion>('/suggest-colors', { method: 'POST', body: form, signal });
}

export function vectorize(
  indexedImage: Blob,
  palette: string[],
  options: Partial<TracingOptions> & { transparent?: number[]; background?: number[] },
  signal?: AbortSignal,
): Promise<VectorizeResponse> {
  const { transparent, background, ...tracing } = options;
  const form = new FormData();
  form.append('image', indexedImage);
  form.append('palette', JSON.stringify(palette));
  for (const [key, value] of Object.entries(tracing)) {
    form.append(key, String(value));
  }
  if (transparent?.length) form.append('transparent', JSON.stringify(transparent));
  if (background?.length) form.append('background', JSON.stringify(background));
  return request<VectorizeResponse>('/vectorize', { method: 'POST', body: form, signal });
}
