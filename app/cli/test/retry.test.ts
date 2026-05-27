import { APICallError } from 'ai'
import { describe, expect, it, vi } from 'vitest'
import { withRetry } from '@/utils/retry'

describe('withRetry', () => {
  it('should return successful result on first attempt', async () => {
    const fn = vi.fn().mockResolvedValue('success')
    const result = await withRetry(fn)
    expect(result).toBe('success')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('should retry on retryable API errors and eventually succeed', async () => {
    const retryableError = new APICallError({
      message: 'Rate limited',
      statusCode: 429,
      responseBody: '{}',
      url: 'https://test.com/v1/chat',
      requestBodyValues: {},
      isRetryable: true,
    })

    const fn = vi.fn()
      .mockRejectedValueOnce(retryableError)
      .mockResolvedValueOnce('success')

    const onRetry = vi.fn()
    const result = await withRetry(fn, onRetry, 3)

    expect(result).toBe('success')
    expect(fn).toHaveBeenCalledTimes(2)
    expect(onRetry).toHaveBeenCalledOnce()
    expect(onRetry).toHaveBeenCalledWith(expect.objectContaining({
      attempt: 1,
      maxRetries: 3,
      statusCode: 429,
    }))
  })

  it('should not retry on non-retryable errors', async () => {
    const nonRetryableError = new APICallError({
      message: 'Bad request',
      statusCode: 400,
      responseBody: '{}',
      url: 'https://test.com/v1/chat',
      requestBodyValues: {},
      isRetryable: false,
    })

    const fn = vi.fn().mockRejectedValue(nonRetryableError)
    const onRetry = vi.fn()

    await expect(withRetry(fn, onRetry, 3)).rejects.toThrow('Bad request')
    expect(fn).toHaveBeenCalledTimes(1)
    expect(onRetry).not.toHaveBeenCalled()
  })

  it('should not retry non-APICallError exceptions', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('Network error'))
    const onRetry = vi.fn()

    await expect(withRetry(fn, onRetry, 3)).rejects.toThrow('Network error')
    expect(fn).toHaveBeenCalledTimes(1)
    expect(onRetry).not.toHaveBeenCalled()
  })

  it('should exhaust retries and throw', { timeout: 30000 }, async () => {
    const retryableError = new APICallError({
      message: 'Server error',
      statusCode: 500,
      responseBody: '{}',
      url: 'https://test.com/v1/chat',
      requestBodyValues: {},
      isRetryable: true,
    })

    const fn = vi.fn().mockRejectedValue(retryableError)
    const onRetry = vi.fn()

    await expect(withRetry(fn, onRetry, 2)).rejects.toThrow('Server error')
    expect(fn).toHaveBeenCalledTimes(3)
    expect(onRetry).toHaveBeenCalledTimes(2)
  })
})
