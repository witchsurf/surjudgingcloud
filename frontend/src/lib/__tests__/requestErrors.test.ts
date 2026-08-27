import { describe, expect, it, vi } from 'vitest';
import { isAbortLikeError, retryReadAfterAbort } from '../requestErrors';

describe('request cancellation handling', () => {
  it('recognizes DOMException and Supabase/PostgREST abort shapes', () => {
    expect(isAbortLikeError(new DOMException('The operation was aborted.', 'AbortError'))).toBe(true);
    expect(isAbortLikeError({ code: '', details: '', hint: '', message: 'AbortError: The operation was aborted.' })).toBe(true);
    expect(isAbortLikeError({ code: 'ABORT_ERR', message: 'request stopped' })).toBe(true);
    expect(isAbortLikeError(new Error('permission denied'))).toBe(false);
  });

  it('retries an aborted read and returns the canonical result', async () => {
    const operation = vi.fn()
      .mockRejectedValueOnce({ message: 'AbortError: The operation was aborted.' })
      .mockResolvedValueOnce({ eventId: 28 });
    const onRetry = vi.fn();

    await expect(retryReadAfterAbort(operation, { baseDelayMs: 0, onRetry })).resolves.toEqual({ eventId: 28 });
    expect(operation).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('does not retry permissions or other non-cancellation failures', async () => {
    const error = new Error('row-level security policy denied');
    const operation = vi.fn().mockRejectedValue(error);

    await expect(retryReadAfterAbort(operation, { baseDelayMs: 0 })).rejects.toBe(error);
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('stops retrying when the caller context becomes stale', async () => {
    const error = { message: 'AbortError: The operation was aborted.' };
    const operation = vi.fn().mockRejectedValue(error);

    await expect(retryReadAfterAbort(operation, {
      baseDelayMs: 0,
      shouldContinue: () => false,
    })).rejects.toBe(error);
    expect(operation).toHaveBeenCalledTimes(1);
  });
});
