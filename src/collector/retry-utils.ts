/**
 * Retry utilities with exponential backoff
 * 要件: 5.3
 */

import type { RetryConfig } from './types.js';

/**
 * Calculate the delay for a given retry attempt using exponential backoff
 * 要件: 5.3 - 指数バックオフアルゴリズム
 * 
 * @param attempt - The retry attempt number (1-based)
 * @param config - Retry configuration
 * @returns Delay in milliseconds
 */
export function calculateBackoff(attempt: number, config: RetryConfig): number {
  if (attempt < 1) {
    return config.initialDelay;
  }

  // Calculate exponential backoff: initialDelay * (multiplier ^ (attempt - 1))
  const delay = config.initialDelay * Math.pow(config.backoffMultiplier, attempt - 1);

  // Cap at maxDelay
  return Math.min(delay, config.maxDelay);
}

/**
 * Execute a function with retry logic and exponential backoff
 * 
 * @param fn - The async function to execute
 * @param config - Retry configuration
 * @param isRetryable - Function to determine if an error is retryable
 * @returns The result of the function
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  config: RetryConfig,
  isRetryable: (error: Error) => boolean = () => true
): Promise<T> {
  let lastError: Error | undefined;
  let attempt = 0;

  while (attempt < config.maxRetries) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Check if error is retryable
      if (!isRetryable(lastError)) {
        throw lastError;
      }

      attempt++;

      // If we've exhausted retries, throw the error
      if (attempt >= config.maxRetries) {
        throw lastError;
      }

      // Calculate delay and wait
      const delay = calculateBackoff(attempt, config);
      await sleep(delay);
    }
  }

  // This should never be reached, but TypeScript needs it
  throw lastError || new Error('Retry failed');
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Default retry configuration
 */
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 5,
  initialDelay: 1000,
  maxDelay: 30000,
  backoffMultiplier: 2,
};
