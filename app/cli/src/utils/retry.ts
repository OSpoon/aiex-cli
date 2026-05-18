import { APICallError } from 'ai'

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
  let lastError: Error | undefined

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn()
    }
    catch (error) {
      const err = error instanceof Error ? error : new Error(String(error))
      lastError = err

      const shouldRetry = err instanceof APICallError && err.isRetryable && attempt < maxRetries
      if (!shouldRetry)
        throw err

      const delayMs = 1000 * 2 ** attempt + Math.round(Math.random() * 500)
      onRetry?.({ attempt: attempt + 1, maxRetries, delayMs, statusCode: err.statusCode })
      await new Promise(resolve => setTimeout(resolve, delayMs))
    }
  }

  throw lastError ?? new Error('Retry failed after all attempts')
}
