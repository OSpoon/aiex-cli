import { describe, expect, it, vi } from 'vitest'
import { shouldSyncNotion, syncResultToNotion, triggerWebhook } from '@/application/integrations'

vi.mock('@/infrastructure/integrations/notion-sink', () => ({
  writeNotionPage: vi.fn(),
}))

vi.mock('@/infrastructure/integrations/webhook-sink', () => ({
  sendWebhook: vi.fn(),
}))

describe('dispatch-extraction-integrations', () => {
  describe('shouldSyncNotion', () => {
    it('should return true when notion is enabled and schema has databaseId', () => {
      const config: any = {
        notion: {
          enabled: true,
          schemas: {
            people: { databaseId: 'db-123' },
          },
        },
      }
      expect(shouldSyncNotion(config, 'people')).toBe(true)
    })

    it('should return false when notion is not enabled', () => {
      const config: any = {
        notion: {
          enabled: false,
          schemas: { people: { databaseId: 'db-123' } },
        },
      }
      expect(shouldSyncNotion(config, 'people')).toBe(false)
    })

    it('should return false when schema has no databaseId', () => {
      const config: any = {
        notion: {
          enabled: true,
          schemas: { people: {} },
        },
      }
      expect(shouldSyncNotion(config, 'people')).toBe(false)
    })

    it('should return false when notion config is missing', () => {
      expect(shouldSyncNotion({} as any, 'people')).toBe(false)
    })
  })

  describe('syncResultToNotion', () => {
    it('should sync data to notion and return page info', async () => {
      const { writeNotionPage } = await import('@/infrastructure/integrations/notion-sink')
      vi.mocked(writeNotionPage).mockResolvedValueOnce({
        databaseId: 'db-1',
        pageId: 'page-1',
        dataSourceId: 'source-1',
      })

      const aiConfig: any = {
        notion: {
          enabled: true,
          token: 'token',
          schemas: { people: { databaseId: 'db-1' } },
        },
      }

      const result = await syncResultToNotion(aiConfig, 'people', { name: 'Alice' })
      expect(result).toEqual([{ databaseId: 'db-1', pageId: 'page-1' }])
    })

    it('should throw for non-object data', async () => {
      const aiConfig: any = { notion: { enabled: true, token: 'token', schemas: {} } }
      await expect(syncResultToNotion(aiConfig, 'people', 'not an object')).rejects.toThrow()
    })

    it('should throw for array data', async () => {
      const aiConfig: any = { notion: { enabled: true, token: 'token', schemas: {} } }
      await expect(syncResultToNotion(aiConfig, 'people', [1, 2, 3])).rejects.toThrow()
    })
  })

  describe('triggerWebhook', () => {
    it('should not send webhook when webhook is not enabled', async () => {
      const { sendWebhook } = await import('@/infrastructure/integrations/webhook-sink')

      await triggerWebhook({} as any, 'audit-1', 'people', 'started', { type: 'file' })
      expect(sendWebhook).not.toHaveBeenCalled()
    })

    it('should send webhook when webhook is enabled', async () => {
      const { sendWebhook } = await import('@/infrastructure/integrations/webhook-sink')
      vi.mocked(sendWebhook).mockResolvedValueOnce(undefined)

      const config: any = {
        webhook: {
          enabled: true,
          url: 'https://hooks.example.com/aiex',
        },
      }

      await triggerWebhook(config, 'audit-1', 'people', 'started', { type: 'file', filePath: '/tmp/test.txt' }, { name: 'Alice' }, undefined, { input: 100, output: 50 }, true)

      expect(sendWebhook).toHaveBeenCalledWith(
        config.webhook,
        expect.objectContaining({
          event: 'started',
          schemaName: 'people',
          auditId: 'audit-1',
          source: expect.objectContaining({ fileName: 'test.txt' }),
          data: { name: 'Alice' },
        }),
      )
    })

    it('should handle webhook errors gracefully', async () => {
      const { sendWebhook } = await import('@/infrastructure/integrations/webhook-sink')
      vi.mocked(sendWebhook).mockRejectedValueOnce(new Error('Webhook timeout'))

      const config: any = {
        webhook: {
          enabled: true,
          url: 'https://hooks.example.com/aiex',
        },
      }

      await expect(triggerWebhook(config, 'audit-1', 'people', 'started', { type: 'file' }, undefined, undefined, undefined, true)).resolves.not.toThrow()
    })
  })
})
