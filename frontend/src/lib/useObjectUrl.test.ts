import { afterEach, describe, expect, it, vi } from 'vitest';
import { cancelRevoke, scheduleRevoke } from './useObjectUrl';

describe('object URL revocation', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('revokes a released URL after one tick', () => {
    vi.useFakeTimers();
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);

    scheduleRevoke('blob:a');
    expect(revoke).not.toHaveBeenCalled();
    vi.runAllTimers();

    expect(revoke).toHaveBeenCalledWith('blob:a');
  });

  it('keeps a URL that is re-mounted before the tick (StrictMode)', () => {
    vi.useFakeTimers();
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);

    scheduleRevoke('blob:b');
    cancelRevoke('blob:b');
    vi.runAllTimers();

    expect(revoke).not.toHaveBeenCalled();
  });
});
