import type { AIConfig } from '@/core/ai-extraction/types'
import type { ExtractionTokensUsed, ExtractionWebhookEvent, ExtractionWebhookSource, NotionSyncPage } from '@/domain/integrations/types'
import path from 'node:path'
import { consola } from 'consola'
import { writeNotionPage } from '@/infrastructure/integrations/notion-sink'
import { sendWebhook } from '@/infrastructure/integrations/webhook-sink'
import { t } from '@/locales'

export async function syncResultToNotion(
  aiConfig: AIConfig,
  schemaName: string,
  data: unknown,
): Promise<NotionSyncPage[]> {
  if (!data || typeof data !== 'object' || Array.isArray(data))
    throw new Error(t('errors.ai.extractionNotObject'))

  const page = await writeNotionPage(aiConfig.notion, schemaName, data as Record<string, unknown>)
  return [{ databaseId: page.databaseId, pageId: page.pageId }]
}

export function shouldSyncNotion(aiConfig: AIConfig, schemaName: string): boolean {
  return !!aiConfig.notion?.enabled && !!aiConfig.notion.schemas?.[schemaName]?.databaseId?.trim()
}

export async function triggerWebhook(
  aiConfig: AIConfig,
  auditId: string,
  schemaName: string,
  event: ExtractionWebhookEvent,
  source: ExtractionWebhookSource,
  data?: unknown,
  error?: string,
  tokensUsed?: ExtractionTokensUsed,
  quiet = false,
): Promise<void> {
  if (!aiConfig.webhook?.enabled)
    return

  try {
    await sendWebhook(aiConfig.webhook, {
      event,
      schemaName,
      auditId,
      timestamp: new Date().toISOString(),
      source: {
        type: source.type,
        fileName: source.filePath ? path.basename(source.filePath) : undefined,
        filePath: source.filePath,
      },
      data,
      error,
      tokensUsed,
    })
    if (!quiet) {
      consola.success(t('command.extract.file.webhookSynced'))
    }
  }
  catch (err) {
    if (!quiet) {
      consola.error(t('command.extract.file.webhookSyncFail', { error: err instanceof Error ? err.message : String(err) }))
    }
  }
}
