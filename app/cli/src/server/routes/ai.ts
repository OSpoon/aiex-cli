import type { MigrationConfig } from '@/core/schema-sqlite/types'
import path from 'node:path'
import { Hono } from 'hono'
import {
  getDefaultAIConfig,
  lookupModelCapabilities,
  readAIConfig,
  writeAIConfig,
} from '@/core/ai-extraction'
import { AIConfigSchema } from '@/core/ai-extraction/schemas'
import { getErrorMessage } from '@/core/schema-sqlite'

export function aiRoutes(config: MigrationConfig): Hono {
  const app = new Hono()
  const aiexDir = path.dirname(config.schemaPath)

  // Read AI config
  app.get('/ai/config', async (c) => {
    const aiConfig = await readAIConfig(aiexDir)

    if (!aiConfig) {
      const defaults = getDefaultAIConfig()
      return c.json({
        ...defaults,
        provider: {
          ...defaults.provider,
          apiKey: '',
        },
      })
    }

    return c.json(aiConfig)
  })

  // Lookup model in registry (sync, no network)
  app.post('/ai/registry-lookup', async (c) => {
    try {
      const body = await c.req.json()
      const { modelName } = body
      const caps = lookupModelCapabilities(modelName || '')
      return c.json(caps ?? {})
    }
    catch {
      return c.json({})
    }
  })

  // Save AI config
  app.put('/ai/config', async (c) => {
    try {
      const body = await c.req.json()

      const systemTpl: string | undefined = body?.prompt?.systemTemplate
      const userTpl: string | undefined = body?.prompt?.userTemplate

      if (!systemTpl || !systemTpl.includes('{schema}')) {
        return c.json(
          { success: false, error: 'System prompt must contain the {schema} placeholder' },
          400,
        )
      }
      if (!userTpl?.includes('{text}')) {
        return c.json(
          { success: false, error: 'User prompt must contain the {text} placeholder' },
          400,
        )
      }

      if (!body.provider?.models?.length) {
        return c.json(
          { success: false, error: 'At least one model must be configured' },
          400,
        )
      }

      const validated = AIConfigSchema.parse(body)
      await writeAIConfig(aiexDir, validated)

      return c.json({ success: true })
    }
    catch (error: unknown) {
      return c.json({ success: false, error: getErrorMessage(error) }, 400)
    }
  })

  return app
}
