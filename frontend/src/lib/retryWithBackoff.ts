/**
 * Exponential Backoff Retry Utility
 *
 * Provides smart retry logic with exponential delay and jitter
 * to avoid thundering herd problems when multiple tablets reconnect simultaneously.
 */

/**
 * Calculate delay before next retry attempt.
 * Uses exponential backoff with ±30% jitter.
 */
function calculateBackoff(attempt: number, baseDelay = 1000, maxDelay = 30000): number {
    const exponentialDelay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
    const jitter = Math.random() * 0.3 * exponentialDelay;
    return Math.floor(exponentialDelay + jitter);
}

/**
 * Retry an async function with exponential backoff.
 *
 * @param fn - Async function to execute
 * @param maxRetries - Maximum number of retry attempts (default: 3)
 * @returns The result of fn() or throws after all retries exhausted
 */
export async function retryWithBackoff<T>(
    fn: () => Promise<T>,
    maxRetries = 3
): Promise<T> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;

            if (attempt === maxRetries) break;

            const delay = calculateBackoff(attempt);
            console.log(`⏳ Retry ${attempt + 1}/${maxRetries} failed, next attempt in ${delay}ms`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }

    throw lastError;
}
