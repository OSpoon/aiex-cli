import type { MigrationConfig } from '@/core/schema-sqlite/types'
import fs from 'node:fs/promises'
import path from 'node:path'
import { Hono } from 'hono'
import { savePromptSnapshot } from '@/core/ai-extraction'
import { runSchemaSync } from '@/core/schema-runner'
import {
  getErrorMessage,
  JsonSchemaDefinitionSchema,
} from '@/core/schema-sqlite'

const SCHEMA_FILE_RE = /^[\w.-]+\.json$/
const TABLE_NAME_RE = /^[a-z][a-z0-9_]*$/

function resolveSchemaFile(schemaDir: string, name: string): string | null {
  if (name !== path.basename(name) || !SCHEMA_FILE_RE.test(name) || name.includes('..')) {
    return null
  }
  return path.join(schemaDir, name)
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
  app.get('/schema/:name', async (c) => {
    const name = c.req.param('name')
    const filePath = resolveSchemaFile(schemaDir, name)
    if (!filePath) {
      return c.json({ error: 'Invalid schema file name' }, 400)
    }

    try {
      const content = await fs.readFile(filePath, 'utf-8')
      return c.json(JSON.parse(content))
    }
    catch {
      return c.json({ error: 'Schema not found' }, 404)
    }
  })

  // Save a schema
  app.post('/schema/:name', async (c) => {
    const name = c.req.param('name')
    const filePath = resolveSchemaFile(schemaDir, name)
    if (!filePath) {
      return c.json({ error: 'Invalid schema file name' }, 400)
    }

    try {
      const body = await c.req.json()
      await ensureDir()
      await fs.writeFile(filePath, `${JSON.stringify(body, null, 2)}\n`)

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
      return c.json({ error: 'Failed to save schema' }, 500)
    }
  })

  // Get prompt snapshot for a schema
  app.get('/prompt-snapshot/:name', async (c) => {
    const name = c.req.param('name')
    if (!TABLE_NAME_RE.test(name)) {
      return c.json({ success: false, error: 'Invalid table name' }, 400)
    }
    const aiexDir = path.dirname(schemaDir)
    const snapshotPath = path.join(aiexDir, 'extracted', `${name}.prompt.md`)

    try {
      const content = await fs.readFile(snapshotPath, 'utf-8')
      return c.json({ success: true, content })
    }
    catch {
      return c.json({ success: false, error: 'Prompt snapshot not found. Save the schema first.' }, 404)
    }
  })

  // Delete a schema
  app.delete('/schema/:name', async (c) => {
    const name = c.req.param('name')
    const filePath = resolveSchemaFile(schemaDir, name)
    if (!filePath) {
      return c.json({ error: 'Invalid schema file name' }, 400)
    }

    try {
      // Read schema content before deleting to get table name for snapshot cleanup
      const aiexDir = path.dirname(schemaDir)
      try {
        const content = await fs.readFile(filePath, 'utf-8')
        const parsed = JsonSchemaDefinitionSchema.safeParse(JSON.parse(content))
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
      return c.json({ error: 'Failed to delete schema' }, 500)
    }
  })

  // Run migration - generate Drizzle schema and apply to database
  app.post('/migrate', async (c) => {
    try {
      await ensureDir()
      const result = await runSchemaSync(config)
      if (!result.success) {
        const status = result.schemaCount === 0 ? 400 : 500
        return c.json({ success: false, error: result.error || 'Migration failed' }, status)
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
