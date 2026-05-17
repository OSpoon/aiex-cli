import type { MigrationConfig } from '@/core/schema-sqlite/types'
import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'
import { Hono } from 'hono'
import { savePromptSnapshot } from '@/core/ai-extraction'
import {
  getErrorMessage,
  JsonSchemaDefinitionSchema,
  parseAllSchemas,
  resolveHelperPath,
  resolveTsxPath,
} from '@/core/schema-sqlite'

const execFileAsync = promisify(execFile)

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
    const filePath = path.join(schemaDir, name)

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
    const filePath = path.join(schemaDir, name)

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
    const filePath = path.join(schemaDir, name)

    try {
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
      await fs.mkdir(path.dirname(config.drizzleSchemaPath), { recursive: true })

      const files = await fs.readdir(schemaDir)
      const jsonFiles = files.filter(f => f.endsWith('.json'))

      if (jsonFiles.length === 0) {
        return c.json({ success: false, error: 'No schema files found' }, 400)
      }

      const entries = await Promise.all(
        jsonFiles.map(async (fileName) => {
          const filePath = path.join(schemaDir, fileName)
          const content = await fs.readFile(filePath, 'utf-8')
          return { filePath, content }
        }),
      )

      const parsedResult = parseAllSchemas(entries)
      if (!parsedResult.success) {
        return c.json({ success: false, error: parsedResult.error }, 400)
      }

      const { tables, relations, reverseRelations, warnings, drizzleCode } = parsedResult.data
      await fs.writeFile(config.drizzleSchemaPath, drizzleCode)

      // Run migration helper
      const helperPath = resolveHelperPath()
      const tsxPath = resolveTsxPath()

      const { stdout, stderr } = await execFileAsync(
        process.execPath,
        [tsxPath, helperPath, config.drizzleSchemaPath, config.migrationsPath, config.databasePath],
        { cwd: process.cwd() },
      )

      // Parse helper output
      let migrationResult: { success: boolean, changes?: number, error?: string, tag?: string }
      try {
        const lines = stdout.trim().split('\n')
        const jsonLine = lines.find(l => l.startsWith('{') && l.endsWith('}'))
        if (!jsonLine) {
          return c.json({ success: false, error: 'Migration helper did not return valid output' }, 500)
        }
        migrationResult = JSON.parse(jsonLine)
      }
      catch {
        return c.json({ success: false, error: stderr || stdout || 'Migration helper failed' }, 500)
      }

      if (!migrationResult.success) {
        return c.json({ success: false, error: migrationResult.error || 'Migration failed' }, 500)
      }

      return c.json({
        success: true,
        changes: migrationResult.changes ?? 0,
        tag: migrationResult.tag,
        tables: tables.length,
        relations: relations.length + reverseRelations.length,
        warnings,
      })
    }
    catch (error: unknown) {
      return c.json({ success: false, error: getErrorMessage(error) }, 500)
    }
  })

  return app
}
