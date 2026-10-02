import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, getLimits } from './client';

describe('api client', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('maps the backend error envelope to ApiError', async () => {
    const body = {
      error: { code: 'FILE_TOO_LARGE', message: 'Too big', details: {} },
      request_id: 'req-1',
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 413 })),
    );

    const error = await getLimits().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 413, code: 'FILE_TOO_LARGE', requestId: 'req-1' });
  });
});
