import type { MigrationConfig } from '@/core/schema-sqlite/types'
import fs from 'node:fs/promises'
import path from 'node:path'
import { zValidator } from '@hono/zod-validator'
import Database from 'better-sqlite3'
import { Hono } from 'hono'
import { readFile as readJsonFile } from 'jsonfile'
import { Kysely, sql, SqliteDialect } from 'kysely'
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

interface SqliteTableInfoRow {
  name: string
  type: string
  notnull: number
  pk: number
}

interface TableColumn {
  name: string
  type: string
  notNull: boolean
  pk: boolean
}

type DynamicDatabase = Record<string, Record<string, unknown>>

function createReadonlyQueryDb(databasePath: string): Kysely<DynamicDatabase> {
  return new Kysely<DynamicDatabase>({
    dialect: new SqliteDialect({
      database: new Database(databasePath, { readonly: true }),
    }),
  })
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

      let db: Kysely<DynamicDatabase> | null = null
      let dbTables: string[] = []
      try {
        db = createReadonlyQueryDb(config.databasePath)
        const tablesResult = await sql<{ name: string }>`
          select name
          from sqlite_master
          where type = 'table' and name not like 'sqlite_%' and name not like '_%'
          order by name
        `.execute(db)
        dbTables = tablesResult.rows.map(row => row.name)
      }
      catch { /* db not ready */ }
      finally {
        await db?.destroy()
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

      let db: Kysely<DynamicDatabase>
      try {
        db = createReadonlyQueryDb(config.databasePath)
      }
      catch {
        return c.json({ error: 'Database not found. Run `aiex schema` first.' }, 400)
      }

      try {
        const tableExists = await sql<{ name: string }>`
          select name
          from sqlite_master
          where type = 'table' and name = ${tableName}
        `.execute(db)

        if (tableExists.rows.length === 0)
          return c.json({ error: `Table "${tableName}" not found in database` }, 404)

        const tableInfo = await sql<SqliteTableInfoRow>`
          pragma table_info(${sql.table(tableName)})
        `.execute(db)

        const columns: TableColumn[] = tableInfo.rows.map(col => ({
          name: col.name,
          type: col.type,
          notNull: !!col.notnull,
          pk: !!col.pk,
        }))

        const searchConditions = columns.map(col => sql`${sql.ref(col.name)} like ${`%${search}%`}`)
        const searchCondition = search
          ? sql`where ${sql.join(searchConditions, sql` or `)}`
          : sql``

        const sortColumn = columns.find(col => col.name === sortField)
        const orderBy = sortColumn
          ? sql`order by ${sql.ref(sortColumn.name)} ${sql.raw(sortOrder === 'desc' ? 'desc' : 'asc')}`
          : sql``

        const countResult = await sql<{ count: number }>`
          select count(*) as count
          from ${sql.table(tableName)}
          ${searchCondition}
        `.execute(db)
        const total = countResult.rows[0]?.count ?? 0

        const offset = (page - 1) * pageSize
        const totalPages = Math.max(1, Math.ceil(total / pageSize))

        const result = await sql<Record<string, unknown>>`
          select *
          from ${sql.table(tableName)}
          ${searchCondition}
          ${orderBy}
          limit ${pageSize}
          offset ${offset}
        `.execute(db)

        return c.json({
          columns,
          rows: result.rows,
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
        await db.destroy()
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
