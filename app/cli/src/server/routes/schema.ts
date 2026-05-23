import type { MigrationConfig } from '@/core/schema-sqlite/types'
import fs from 'node:fs/promises'
import path from 'node:path'
import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { readFile as readJsonFile, writeFile as writeJsonFile } from 'jsonfile'
import { z } from 'zod'
import { savePromptSnapshot } from '@/core/ai-extraction'
import { runSchemaSync } from '@/core/schema-runner'
import {
  getErrorMessage,
  JsonSchemaDefinitionSchema,
} from '@/core/schema-sqlite'
import { t } from '@/locales'

const schemaFileNameSchema = z
  .string()
  .regex(/^[\w.-]+\.json$/)
  .refine(name => name === path.basename(name) && !name.includes('..'))

const schemaFileParamSchema = z.object({
  name: schemaFileNameSchema,
})

const tableNameParamSchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9_]*$/),
})

function invalidParamResponse(message: string) {
  return (result: { success: boolean }, c: any) => {
    if (!result.success)
      return c.json({ error: message }, 400)
  }
}

export function schemaRoutes(config: MigrationConfig): Hono {
  const app = new Hono()
  const schemaDir = config.schemaPath

  const ensureDir = async (): Promise<void> => {
    await fs.mkdir(schemaDir, { recursive: true })
  }

  // List all schema files
  app.get('/schema', async (c) => {
    await ensureDir()
    const files = await fs.readdir(schemaDir)
    const jsonFiles = files.filter(f => f.endsWith('.json'))
    return c.json(jsonFiles)
  })

  // Get a specific schema
  app.get('/schema/:name', zValidator('param', schemaFileParamSchema, invalidParamResponse(t('server.invalidTableName'))), async (c) => {
    const { name } = c.req.valid('param')
    const filePath = path.join(schemaDir, name)

    try {
      return c.json(await readJsonFile(filePath))
    }
    catch {
      return c.json({ error: t('server.schemaNotFound') }, 404)
    }
  })

  // Save a schema
  app.post('/schema/:name', zValidator('param', schemaFileParamSchema, invalidParamResponse(t('server.invalidTableName'))), async (c) => {
    const { name } = c.req.valid('param')
    const filePath = path.join(schemaDir, name)

    try {
      const body = await c.req.json()
      await ensureDir()
      await writeJsonFile(filePath, body, { spaces: 2, EOL: '\n' })

      // Generate prompt snapshot for AI extraction
      const aiexDir = path.dirname(schemaDir)
      try {
        const validated = JsonSchemaDefinitionSchema.parse(body)
        await savePromptSnapshot(validated, aiexDir)
      }
      catch {
        // Schema may not be valid yet (e.g. incomplete), skip snapshot
      }

      return c.json({ success: true })
    }
    catch {
      return c.json({ error: t('server.saveSchemaFailed') }, 500)
    }
  })

  // Get prompt snapshot for a schema
  app.get('/prompt-snapshot/:name', zValidator('param', tableNameParamSchema, invalidParamResponse(t('server.invalidTableName'))), async (c) => {
    const { name } = c.req.valid('param')
    const aiexDir = path.dirname(schemaDir)
    const snapshotPath = path.join(aiexDir, 'extracted', `${name}.prompt.md`)

    try {
      const content = await fs.readFile(snapshotPath, 'utf-8')
      return c.json({ success: true, content })
    }
    catch {
      return c.json({ success: false, error: t('server.promptSnapshotNotAvailable') }, 404)
    }
  })

  // Delete a schema
  app.delete('/schema/:name', zValidator('param', schemaFileParamSchema, invalidParamResponse(t('server.invalidTableName'))), async (c) => {
    const { name } = c.req.valid('param')
    const filePath = path.join(schemaDir, name)

    try {
      // Read schema content before deleting to get table name for snapshot cleanup
      const aiexDir = path.dirname(schemaDir)
      try {
        const parsed = JsonSchemaDefinitionSchema.safeParse(await readJsonFile(filePath))
        if (parsed.success) {
          const tableName = parsed.data.table.name
          const snapshotPath = path.join(aiexDir, 'extracted', `${tableName}.prompt.md`)
          await fs.unlink(snapshotPath).catch(() => {})
        }
      }
      catch {
        // Schema file may be invalid; skip snapshot cleanup
      }

      await fs.unlink(filePath)
      return c.json({ success: true })
    }
    catch {
      return c.json({ error: t('server.deleteSchemaFailed') }, 500)
    }
  })

  // Run migration - generate Drizzle schema and apply to database
  app.post('/migrate', async (c) => {
    try {
      await ensureDir()
      const result = await runSchemaSync(config)
      if (!result.success) {
        const status = result.schemaCount === 0 ? 400 : 500
        return c.json({ success: false, error: result.error || t('server.migrationFailed') }, status)
      }

      return c.json({
        success: true,
        changes: result.migration?.changes ?? 0,
        tag: result.migration?.tag,
        tables: result.tables,
        relations: result.relations,
        warnings: result.warnings,
      })
    }
    catch (error: unknown) {
      return c.json({ success: false, error: getErrorMessage(error) }, 500)
    }
  })

  return app
}
