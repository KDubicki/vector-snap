import type {
  ApiErrorBody,
  ColorSuggestion,
  FilamentPlan,
  Limits,
  QuantizeParams,
  QuantizeResponse,
  TracingOptions,
  VectorizeResponse,
} from '../types/api';

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '/api';

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

/** Message to show for a failed request (`ApiError` carries the backend's message). */
export function errorMessage(error: unknown, fallback = 'Unexpected error'): string {
  return error instanceof Error ? error.message : fallback;
}

async function toApiError(response: Response): Promise<ApiError> {
  const body = (await response.json().catch(() => null)) as ApiErrorBody | null;
  return new ApiError(
    response.status,
    body?.error.code ?? 'UNKNOWN_ERROR',
    body?.error.message ?? response.statusText,
    body?.request_id ?? response.headers.get('X-Request-ID'),
  );
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE_URL}/v1${path}`, init);
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
  const response = await fetch(`${BASE_URL}/v1/export/${format}`, {
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
  options: Partial<TracingOptions> & { transparent?: number[] },
  signal?: AbortSignal,
): Promise<VectorizeResponse> {
  const { transparent, ...tracing } = options;
  const form = new FormData();
  form.append('image', indexedImage);
  form.append('palette', JSON.stringify(palette));
  for (const [key, value] of Object.entries(tracing)) {
    form.append(key, String(value));
  }
  if (transparent?.length) form.append('transparent', JSON.stringify(transparent));
  return request<VectorizeResponse>('/vectorize', { method: 'POST', body: form, signal });
}
