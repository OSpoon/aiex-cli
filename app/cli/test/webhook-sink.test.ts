import type { WebhookPayload } from '@/core/webhook-sink'
import crypto from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { sendWebhook } from '@/core/webhook-sink'

describe('webhook-sink', () => {
  it('does not send webhook if disabled or config is missing', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    await sendWebhook(undefined, {} as any)
    await sendWebhook({ enabled: false, url: 'http://test.local' }, {} as any)
    await sendWebhook({ enabled: true, url: '' }, {} as any)

    expect(fetchSpy).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('sends POST request to url with correct payload', async () => {
    const mockResponse = { ok: true, status: 200, statusText: 'OK' }
    const fetchSpy = vi.fn().mockResolvedValue(mockResponse)
    vi.stubGlobal('fetch', fetchSpy)

    const config = {
      enabled: true,
      url: 'http://localhost:8080/my-webhook',
    }

    const payload: WebhookPayload = {
      event: 'extraction.success',
      schemaName: 'test-schema',
      auditId: 'audit-123',
      timestamp: '2026-05-23T12:00:00.000Z',
      source: { type: 'file', fileName: 'test.pdf', filePath: '/path/to/test.pdf' },
      data: { key: 'value' },
      tokensUsed: { prompt: 10, completion: 5, total: 15 },
    }

    await sendWebhook(config, payload)

    expect(fetchSpy).toHaveBeenCalledWith(config.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'aiex-webhook-dispatcher',
      },
      body: JSON.stringify(payload),
    })

    vi.unstubAllGlobals()
  })

  it('throws error if fetch response is not ok', async () => {
    const mockResponse = { ok: false, status: 500, statusText: 'Internal Server Error' }
    const fetchSpy = vi.fn().mockResolvedValue(mockResponse)
    vi.stubGlobal('fetch', fetchSpy)

    const config = {
      enabled: true,
      url: 'http://localhost:8080/my-webhook',
    }

    await expect(sendWebhook(config, {} as any)).rejects.toThrow(
      'Webhook request failed with status: 500 Internal Server Error',
    )

    vi.unstubAllGlobals()
  })

  it('signs payload with HMAC-SHA256 signature if secret is provided', async () => {
    const mockResponse = { ok: true, status: 200, statusText: 'OK' }
    const fetchSpy = vi.fn().mockResolvedValue(mockResponse)
    vi.stubGlobal('fetch', fetchSpy)

    const config = {
      enabled: true,
      url: 'http://localhost:8080/my-webhook',
      secret: 'my-super-secret-key',
    }

    const payload: WebhookPayload = {
      event: 'extraction.success',
      schemaName: 'test-schema',
      auditId: 'audit-123',
      timestamp: '2026-05-23T12:00:00.000Z',
      source: { type: 'file', fileName: 'test.pdf', filePath: '/path/to/test.pdf' },
      data: { key: 'value' },
    }

    await sendWebhook(config, payload)

    const expectedSignature = crypto
      .createHmac('sha256', config.secret)
      .update(JSON.stringify(payload))
      .digest('hex')

    expect(fetchSpy).toHaveBeenCalledWith(config.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'aiex-webhook-dispatcher',
        'X-Aiex-Signature': `sha256=${expectedSignature}`,
      },
      body: JSON.stringify(payload),
    })

    vi.unstubAllGlobals()
  })
})
