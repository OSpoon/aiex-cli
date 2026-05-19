import type { MigrationConfig } from '@/core/schema-sqlite/types'
import fs from 'node:fs/promises'
import path from 'node:path'
import { zValidator } from '@hono/zod-validator'
import Database from 'better-sqlite3'
import { Hono } from 'hono'
import { readFile as readJsonFile } from 'jsonfile'
import { z } from 'zod'

const FILE_REGEX = /\.json$/
const TIMESTAMP_CLEANUP = /(\d{2})-(\d{2})-(\d{2})/
const TIMESTAMP_TZ = /(\d{3})Z/

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
})

function invalidParamResponse(message: string) {
  return (result: { success: boolean }, c: any) => {
    if (!result.success)
      return c.json({ error: message }, 400)
  }
}

interface ExtractionRecord {
  name: string
  schemaName: string
  timestamp: string
  fileSize: number
  modifiedAt: string
}

export function dataRoutes(config: MigrationConfig): Hono {
  const app = new Hono()
  const aiexDir = path.dirname(config.schemaPath)
  const extractedDir = path.join(aiexDir, 'extracted')

  app.get('/data', async (c) => {
    try {
      await fs.mkdir(extractedDir, { recursive: true })
      const files = await fs.readdir(extractedDir)
      const jsonFiles = files.filter(f => f.endsWith('.json') && !f.endsWith('.prompt.md'))

      const records: ExtractionRecord[] = []

      for (const file of jsonFiles) {
        const name = file.replace(FILE_REGEX, '')
        const idx = name.lastIndexOf('-')

        if (idx === -1)
          continue

        const schemaName = name.slice(0, idx)
        const rawTimestamp = name.slice(idx + 1)
        const timestamp = rawTimestamp
          .replace(/-/g, (d: string, i: number) => (i === 4 || i === 7) ? '-' : d)
          .replace(TIMESTAMP_CLEANUP, (_, h, m, s) => `${h}:${m}:${s}`)
          .replace(TIMESTAMP_TZ, '.$1Z')

        const filePath = path.join(extractedDir, file)
        try {
          const stat = await fs.stat(filePath)
          records.push({
            name: file,
            schemaName,
            timestamp,
            fileSize: stat.size,
            modifiedAt: stat.mtime.toISOString(),
          })
        }
        catch { continue }
      }

      records.sort((a, b) => b.timestamp.localeCompare(a.timestamp))
      return c.json(records)
    }
    catch (error: unknown) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 500)
    }
  })

  // ── Table data endpoints ──

  app.get('/data/tables', async (c) => {
    try {
      const schemaDir = config.schemaPath
      let schemaFiles: string[] = []
      try {
        schemaFiles = (await fs.readdir(schemaDir)).filter(f => f.endsWith('.json'))
      }
      catch {
        schemaFiles = []
      }

      let db: Database.Database | null = null
      let dbTables: string[] = []
      try {
        db = new Database(config.databasePath, { readonly: true })
        dbTables = db.prepare(
          `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_%' ORDER BY name`,
        ).all().map((r: any) => r.name)
      }
      catch { /* db not ready */ }
      finally {
        db?.close()
      }

      const tables: Array<{ name: string, title: string, hasData: boolean }> = []

      for (const file of schemaFiles) {
        try {
          const schema = await readJsonFile(path.join(schemaDir, file))
          const tableName = schema.table?.name

          if (!tableName)
            continue

          tables.push({
            name: tableName,
            title: schema.title || tableName,
            hasData: dbTables.includes(tableName),
          })
        }
        catch { continue }
      }

      return c.json(tables)
    }
    catch (error: unknown) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 500)
    }
  })

  app.get(
    '/data/tables/:name',
    zValidator('param', tableParamSchema, invalidParamResponse('Invalid table name')),
    zValidator('query', tableQuerySchema),
    async (c) => {
      const { name: tableName } = c.req.valid('param')
      const { page, pageSize, search, sortField, sortOrder } = c.req.valid('query')

      let db: Database.Database
      try {
        db = new Database(config.databasePath, { readonly: true })
      }
      catch {
        return c.json({ error: 'Database not found. Run `aiex schema` first.' }, 400)
      }

      try {
        const tableExists = db.prepare(
          `SELECT name FROM sqlite_master WHERE type='table' AND name=?`,
        ).get(tableName)

        if (!tableExists) {
          db.close()
          return c.json({ error: `Table "${tableName}" not found in database` }, 404)
        }

        const columns = db.prepare(`PRAGMA table_info(\`${tableName}\`)`).all().map((col: any) => ({
          name: col.name,
          type: col.type,
          notNull: !!col.notnull,
          pk: !!col.pk,
        }))

        let orderClause = ''
        if (sortField && columns.some((c: any) => c.name === sortField)) {
          const dir = sortOrder === 'desc' ? 'DESC' : 'ASC'
          orderClause = ` ORDER BY \`${sortField}\` ${dir}`
        }

        let whereClause = ''
        const queryParams: string[] = []
        if (search) {
          const conditions = columns.map((col: any) => {
            queryParams.push(`%${search}%`)
            return `\`${col.name}\` LIKE ?`
          })
          whereClause = ` WHERE ${conditions.join(' OR ')}`
        }

        const countRow = db.prepare(
          `SELECT COUNT(*) as count FROM \`${tableName}\`${whereClause}`,
        ).get(...queryParams) as any
        const total = countRow.count

        const offset = (page - 1) * pageSize
        const totalPages = Math.max(1, Math.ceil(total / pageSize))

        const rows = db.prepare(
          `SELECT * FROM \`${tableName}\`${whereClause}${orderClause} LIMIT ? OFFSET ?`,
        ).all(...queryParams, pageSize, offset)

        return c.json({
          columns,
          rows,
          total,
          page,
          pageSize,
          totalPages,
        })
      }
      catch (error: unknown) {
        return c.json({ error: error instanceof Error ? error.message : String(error) }, 500)
      }
      finally {
        db.close()
      }
    },
  )

  app.get('/data/:name', zValidator('param', extractionFileParamSchema, invalidParamResponse('Invalid extraction file name')), async (c) => {
    const { name } = c.req.valid('param')
    const filePath = path.join(extractedDir, name)

    try {
      const content = await fs.readFile(filePath, 'utf-8')
      return c.json({ success: true, content, name })
    }
    catch {
      return c.json({ error: 'Extraction result not found' }, 404)
    }
  })

  return app
}
