import type { MigrationConfig } from '@/core/schema-sqlite/types'
import fs from 'node:fs/promises'
import path from 'node:path'
import Database from 'better-sqlite3'
import { Hono } from 'hono'

const FILE_REGEX = /\.json$/
const EXTRACTION_FILE_RE = /^[\w.-]+\.json$/
const TABLE_NAME_RE = /^[a-z][a-z0-9_]*$/
const TIMESTAMP_CLEANUP = /(\d{2})-(\d{2})-(\d{2})/
const TIMESTAMP_TZ = /(\d{3})Z/

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
          const content = await fs.readFile(path.join(schemaDir, file), 'utf-8')
          const schema = JSON.parse(content)
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

  app.get('/data/tables/:name', async (c) => {
    const tableName = c.req.param('name')
    if (!TABLE_NAME_RE.test(tableName)) {
      return c.json({ error: 'Invalid table name' }, 400)
    }
    const sortField = c.req.query('sortField')
    const sortOrder = c.req.query('sortOrder') || 'asc'
    const page = Math.max(1, Number.parseInt(c.req.query('page') || '1', 10) || 1)
    const pageSize = Math.min(500, Math.max(1, Number.parseInt(c.req.query('pageSize') || '50', 10) || 50))
    const search = c.req.query('search') || ''

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
        const dir = sortOrder.toLowerCase() === 'desc' ? 'DESC' : 'ASC'
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
  })

  app.get('/data/:name', async (c) => {
    const name = c.req.param('name')
    if (name !== path.basename(name) || !EXTRACTION_FILE_RE.test(name) || name.includes('..')) {
      return c.json({ error: 'Invalid extraction file name' }, 400)
    }
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
