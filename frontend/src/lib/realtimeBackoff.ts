/**
 * Realtime Reconnection Backoff Utility
 *
 * Shared exponential backoff + jitter computation for all Supabase Realtime
 * channel reconnection strategies. Prevents "thundering herd" reconnections
 * when beach WiFi drops and restores across multiple judge tablets.
 */

export interface BackoffOptions {
  /** Base delay in ms (default: 3000) */
  baseMs?: number;
  /** Maximum delay cap in ms (default: 30000) */
  maxMs?: number;
  /** Add random jitter to prevent synchronized reconnection storms (default: true) */
  jitter?: boolean;
}

const DEFAULT_BASE_MS = 3000;
const DEFAULT_MAX_MS = 30000;

/**
 * Computes the reconnection delay using exponential backoff with optional jitter.
 *
 * Formula: min(maxMs, baseMs × 2^retryCount) + random(0, baseMs) if jitter
 *
 * @param retryCount - The current retry attempt number (0-indexed)
 * @param opts - Optional configuration overrides
 * @returns Delay in milliseconds before next reconnection attempt
 *
 * @example
 * // Retry 0: ~3000-6000ms, Retry 1: ~6000-9000ms, Retry 2: ~12000-15000ms, etc.
 * const delay = computeReconnectDelay(retryCount);
 * setTimeout(reconnect, delay);
 */
export function computeReconnectDelay(
  retryCount: number,
  opts?: BackoffOptions,
): number {
  const baseMs = opts?.baseMs ?? DEFAULT_BASE_MS;
  const maxMs = opts?.maxMs ?? DEFAULT_MAX_MS;
  const useJitter = opts?.jitter !== false;

  const exponential = Math.min(maxMs, baseMs * 2 ** Math.max(retryCount, 0));
  const jitter = useJitter ? Math.random() * baseMs : 0;

  return exponential + jitter;
}

/**
 * Returns a `reconnectAfterMs` callback suitable for the Supabase Realtime
 * client configuration. Uses exponential backoff with jitter.
 *
 * @example
 * createClient(url, key, {
 *   realtime: {
 *     reconnectAfterMs: createReconnectAfterMs(),
 *   },
 * });
 */
export function createReconnectAfterMs(
  opts?: BackoffOptions,
): (tries: number) => number {
  return (tries: number) => computeReconnectDelay(tries, opts);
}
