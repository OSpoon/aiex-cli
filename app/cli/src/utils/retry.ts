import { APICallError } from 'ai'
import pRetry from 'p-retry'

export interface RetryInfo {
  attempt: number
  maxRetries: number
  delayMs: number
  statusCode: number | undefined
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  onRetry?: (info: RetryInfo) => void,
  maxRetries = 5,
): Promise<T> {
  return pRetry(
    async () => fn(),
    {
      retries: maxRetries,
      factor: 2,
      minTimeout: 1000,
      randomize: true,
      onFailedAttempt({ error, attemptNumber, retriesLeft }) {
        if (!(error instanceof APICallError) || !error.isRetryable || retriesLeft <= 0)
          return

        const baseDelayMs = 1000 * 2 ** (attemptNumber - 1)
        onRetry?.({
          attempt: attemptNumber,
          maxRetries,
          delayMs: baseDelayMs,
          statusCode: error.statusCode,
        })
      },
      shouldRetry({ error }) {
        return error instanceof APICallError && error.isRetryable
      },
    },
  )
}
