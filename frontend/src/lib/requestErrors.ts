type ErrorLike = {
  name?: unknown;
  code?: unknown;
  message?: unknown;
  details?: unknown;
  cause?: unknown;
};

const abortTextPattern = /\babort(?:ed|error)?\b|operation was aborted|signal is aborted/i;

const asErrorLike = (value: unknown): ErrorLike | null =>
  value !== null && typeof value === 'object' ? value as ErrorLike : null;

/**
 * Supabase/PostgREST may expose browser cancellations as a plain object instead
 * of a DOMException. Keep detection independent from `instanceof` so Safari and
 * minified production builds are handled consistently.
 */
export const isAbortLikeError = (error: unknown): boolean => {
  const candidate = asErrorLike(error);
  if (!candidate) {
    return typeof error === 'string' && abortTextPattern.test(error);
  }

  const name = String(candidate.name ?? '');
  const code = String(candidate.code ?? '').toUpperCase();
  const message = String(candidate.message ?? '');
  const details = String(candidate.details ?? '');

  if (name === 'AbortError' || code === 'ABORT_ERR') return true;
  if (abortTextPattern.test(message) || abortTextPattern.test(details)) return true;

  return candidate.cause !== undefined && candidate.cause !== error
    ? isAbortLikeError(candidate.cause)
    : false;
};

export interface AbortReadRetryOptions {
  retries?: number;
  baseDelayMs?: number;
  shouldContinue?: () => boolean;
  onRetry?: (error: unknown, attempt: number) => void;
}

/**
 * Retry read-only operations after a browser cancellation. This helper must not
 * be used for writes because an aborted response does not prove that a mutation
 * was not committed by the server.
 */
export async function retryReadAfterAbort<T>(
  operation: () => Promise<T>,
  options: AbortReadRetryOptions = {},
): Promise<T> {
  const retries = Math.max(0, options.retries ?? 2);
  const baseDelayMs = Math.max(0, options.baseDelayMs ?? 250);

  for (let attempt = 0; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      const canRetry = isAbortLikeError(error)
        && attempt < retries
        && (options.shouldContinue?.() ?? true);

      if (!canRetry) throw error;

      options.onRetry?.(error, attempt + 1);
      const delayMs = baseDelayMs * (attempt + 1);
      if (delayMs > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }
}
