import type { WebhookConfig } from '@/core/ai-extraction'
import crypto from 'node:crypto'

export interface WebhookPayload {
  event: 'extraction.success' | 'extraction.failed'
  schemaName: string
  auditId: string
  timestamp: string
  source: {
    type: 'file' | 'text'
    fileName?: string
    filePath?: string
  }
  data?: unknown
  error?: string
  tokensUsed?: {
    prompt: number
    completion: number
    total: number
  }
}

export async function sendWebhook(
  config: WebhookConfig | undefined,
  payload: WebhookPayload,
): Promise<void> {
  if (!config || !config.enabled || !config.url) {
    return
  }

  const body = JSON.stringify(payload)
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'aiex-webhook-dispatcher',
  }

  if (config.secret) {
    const signature = crypto
      .createHmac('sha256', config.secret)
      .update(body)
      .digest('hex')
    headers['X-Aiex-Signature'] = `sha256=${signature}`
  }

  const response = await fetch(config.url, {
    method: 'POST',
    headers,
    body,
  })

  if (!response.ok) {
    throw new Error(`Webhook request failed with status: ${response.status} ${response.statusText}`)
  }
}
