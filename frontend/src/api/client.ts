import type {
  ApiErrorBody,
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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE_URL}/v1${path}`, init);
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as ApiErrorBody | null;
    throw new ApiError(
      response.status,
      body?.error.code ?? 'UNKNOWN_ERROR',
      body?.error.message ?? response.statusText,
      body?.request_id ?? response.headers.get('X-Request-ID'),
    );
  }
  return (await response.json()) as T;
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
  return request<QuantizeResponse>('/quantize', { method: 'POST', body: form, signal });
}

export function vectorize(
  indexedImage: Blob,
  palette: string[],
  options: Partial<TracingOptions>,
  signal?: AbortSignal,
): Promise<VectorizeResponse> {
  const form = new FormData();
  form.append('image', indexedImage);
  form.append('palette', JSON.stringify(palette));
  for (const [key, value] of Object.entries(options)) {
    form.append(key, String(value));
  }
  return request<VectorizeResponse>('/vectorize', { method: 'POST', body: form, signal });
}
