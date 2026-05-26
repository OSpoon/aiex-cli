import type { MigrationConfig } from '@/types'
import fs from 'node:fs/promises'
import path from 'node:path'
import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import {
  getTableData,
  listExtractions,
  listTables,
  retryNotionSync,
  schemaNameFromExtractionFile,
} from '@/core/data-service'
import { t } from '@/locales'

const tableParamSchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9_]*$/),
})

const extractionFileParamSchema = z.object({
  name: z
    .string()
    .regex(/^[\w.-]+\.json$/)
    .refine(name => name === path.basename(name) && !name.includes('..')),
})

const tableQuerySchema = z.object({
  page: z.coerce.number().int().min(1).catch(1),
  pageSize: z.coerce.number().int().min(1).max(500).catch(50),
  search: z.string().catch(''),
  sortField: z.string().optional(),
  sortOrder: z.preprocess(
    value => typeof value === 'string' ? value.toLowerCase() : value,
    z.enum(['asc', 'desc']).catch('asc'),
  ),
  all: z.preprocess(
    value => value === 'true' || value === true,
    z.boolean().catch(false),
  ),
})

function invalidParamResponse(message: string) {
  return (result: { success: boolean }, c: any) => {
    if (!result.success)
      return c.json({ error: message }, 400)
  }
}

export function dataRoutes(config: MigrationConfig): Hono {
  const app = new Hono()
  const aiexDir = path.dirname(config.schemaPath)
  const extractedDir = path.join(aiexDir, 'extracted')

  app.get('/data', async (c) => {
    try {
      const records = await listExtractions(config)
      return c.json(records)
    }
    catch (error: unknown) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 500)
    }
  })

  // ── Table data endpoints ──

  app.get('/data/tables', async (c) => {
    try {
      const tables = await listTables(config)
      return c.json(tables)
    }
    catch (error: unknown) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 500)
    }
  })

  app.get(
    '/data/tables/:name',
    zValidator('param', tableParamSchema, invalidParamResponse(t('server.invalidTableName'))),
    zValidator('query', tableQuerySchema),
    async (c) => {
      const { name: tableName } = c.req.valid('param')
      const query = c.req.valid('query')

      try {
        const result = await getTableData(config, tableName, query)
        return c.json(result)
      }
      catch (error: unknown) {
        const errMessage = error instanceof Error ? error.message : String(error)
        const status = errMessage.includes('not found') ? 404 : 500
        return c.json({ error: errMessage }, status)
      }
    },
  )

  app.get('/data/:name', zValidator('param', extractionFileParamSchema, invalidParamResponse(t('server.invalidFileName'))), async (c) => {
    const { name } = c.req.valid('param')
    const filePath = path.join(extractedDir, name)

    try {
      const content = await fs.readFile(filePath, 'utf-8')
      return c.json({ success: true, content, name })
    }
    catch {
      return c.json({ error: t('server.extractionNotFound') }, 404)
    }
  })

  app.post('/data/:name/notion/retry', zValidator('param', extractionFileParamSchema, invalidParamResponse(t('server.invalidFileName'))), async (c) => {
    const { name } = c.req.valid('param')
    const schemaName = schemaNameFromExtractionFile(name)
    if (!schemaName)
      return c.json({ success: false, error: t('server.cannotInferSchema') }, 400)

    try {
      const result = await retryNotionSync(config, name)
      return c.json(result)
    }
    catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      return c.json({
        success: false,
        error: message,
      }, 500)
    }
  })

  return app
}
