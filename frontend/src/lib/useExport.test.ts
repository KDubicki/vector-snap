// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/client';
import { useExport } from './useExport';

const downloaded: string[] = [];

vi.mock('./download', () => ({
  download: (_blob: Blob, name: string) => downloaded.push(name),
}));

/** A build that finishes when `resolve` is called and rejects on abort. */
function pendingBuild() {
  let resolve: (blob: Blob) => void = () => {};
  const build = vi.fn(
    (signal: AbortSignal) =>
      new Promise<Blob>((done, fail) => {
        resolve = done;
        signal.addEventListener('abort', () => fail(new DOMException('Aborted', 'AbortError')));
      }),
  );
  return { build, resolve: (blob = new Blob(['x'])) => resolve(blob) };
}

describe('useExport', () => {
  beforeEach(() => void (downloaded.length = 0));
  afterEach(() => vi.restoreAllMocks());

  it('downloads the built file and reports progress meanwhile', async () => {
    const { result } = renderHook(() => useExport());
    const pending = pendingBuild();

    let done: Promise<void> = Promise.resolve();
    act(() => void (done = result.current.run(pending.build, 'logo.stl')));
    expect(result.current.exporting).toBe(true);

    // A second export while one runs is ignored.
    await act(() => result.current.run(pending.build, 'other.stl'));
    expect(pending.build).toHaveBeenCalledOnce();

    await act(async () => {
      pending.resolve();
      await done;
    });
    expect(result.current.exporting).toBe(false);
    expect(downloaded).toEqual(['logo.stl']);
    expect(result.current.error).toBeNull();
  });

  it('reports failures with the API message', async () => {
    const { result } = renderHook(() => useExport());

    await act(() =>
      result.current.run(
        () => Promise.reject(new ApiError(422, 'INVALID_PARAMETERS', 'Too thin', null)),
        'logo.stl',
      ),
    );

    expect(result.current.error).toBe('Too thin');
    expect(downloaded).toEqual([]);
    act(() => result.current.setError(null));
    expect(result.current.error).toBeNull();
  });

  it('cancels without an error or a download, even if the build ignores the signal', async () => {
    const { result } = renderHook(() => useExport());
    const pending = pendingBuild();
    let done: Promise<void> = Promise.resolve();
    act(() => void (done = result.current.run(pending.build, 'logo.stl')));

    await act(async () => {
      result.current.cancel();
      await done;
    });
    expect(result.current).toMatchObject({ exporting: false, error: null });

    // A build that ignores the signal (PNG in the browser) is dropped after cancelling.
    let finish: (blob: Blob) => void = () => {};
    const stubborn = () => new Promise<Blob>((resolve) => (finish = resolve));
    act(() => void (done = result.current.run(stubborn, 'logo.png')));
    await act(async () => {
      result.current.cancel();
      finish(new Blob(['png']));
      await done;
    });
    await waitFor(() => expect(result.current.exporting).toBe(false));
    expect(downloaded).toEqual([]);
  });
});
