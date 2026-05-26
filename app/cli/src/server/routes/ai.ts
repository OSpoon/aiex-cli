import type { MigrationConfig } from '@/types'
import path from 'node:path'
import { Hono } from 'hono'
import { readFile as readJsonFile } from 'jsonfile'
import {
  getDefaultAIConfig,
  lookupModelCapabilities,
  readAIConfig,
  writeAIConfig,
} from '@/core/ai-extraction'
import { AIConfigSchema } from '@/core/ai-extraction/schemas'
import { inspectNotionDatabase, parseNotionDatabaseId } from '@/core/notion-sink'
import { getErrorMessage } from '@/core/schema-sqlite'
import { t } from '@/locales'

const JSON_EXT_RE = /\.json$/i

function extractSchemaFields(schema: any): Array<{ name: string, title?: string, description?: string }> {
  if (!schema?.properties || typeof schema.properties !== 'object')
    return []

  const fields: Array<{ name: string, title?: string, description?: string }> = []

  function visitProperties(properties: Record<string, any>, prefix = ''): void {
    for (const [name, property] of Object.entries(properties)) {
      const fieldName = prefix ? `${prefix}.${name}` : name
      if (property?.type === 'object' && property?.properties && typeof property.properties === 'object') {
        visitProperties(property.properties, fieldName)
        continue
      }
      if (property?.type === 'array' && property?.items?.type === 'object')
        continue

      fields.push({
        name: fieldName,
        title: typeof property?.title === 'string' ? property.title : undefined,
        description: typeof property?.description === 'string' ? property.description : undefined,
      })
    }
  }

  visitProperties(schema.properties)
  return fields
}

async function loadSchemaFields(config: MigrationConfig, schemaName: string): Promise<Array<{ name: string, title?: string, description?: string }>> {
  const safeName = path.basename(schemaName).replace(JSON_EXT_RE, '')
  const schemaPath = path.join(config.schemaPath, `${safeName}.json`)
  const schema = await readJsonFile(schemaPath)
  return extractSchemaFields(schema)
}

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

  app.post('/ai/notion/inspect', async (c) => {
    try {
      const body = await c.req.json()
      const token = typeof body.token === 'string' ? body.token : ''
      const databaseId = typeof body.databaseId === 'string' ? body.databaseId : ''
      const schemaName = typeof body.schemaName === 'string' ? body.schemaName : ''

      if (!schemaName) {
        return c.json({ success: false, error: t('server.schemaRequired') }, 400)
      }

      const result = await inspectNotionDatabase({
        token,
        databaseId,
        schemaFields: await loadSchemaFields(config, schemaName),
      })
      return c.json({ success: true, ...result })
    }
    catch (error: unknown) {
      return c.json({ success: false, error: getErrorMessage(error) }, 400)
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
          { success: false, error: t('server.promptSchemaPlaceholder') },
          400,
        )
      }
      if (!userTpl?.includes('{text}')) {
        return c.json(
          { success: false, error: t('server.promptTextPlaceholder') },
          400,
        )
      }

      if (!body.provider?.models?.length) {
        return c.json(
          { success: false, error: t('server.atLeastOneModel') },
          400,
        )
      }
      if (body.notion?.enabled) {
        if (!body.notion.token?.trim()) {
          return c.json(
            { success: false, error: t('server.notionTokenRequired') },
            400,
          )
        }
        for (const [schemaName, schemaConfig] of Object.entries(body.notion.schemas ?? {}) as Array<[string, any]>) {
          if (typeof schemaConfig.databaseId === 'string') {
            schemaConfig.databaseId = parseNotionDatabaseId(schemaConfig.databaseId)
          }
          if (!schemaConfig.databaseId?.trim()) {
            return c.json(
              { success: false, error: t('server.notionDbIdRequired', { name: schemaName }) },
              400,
            )
          }
        }
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
