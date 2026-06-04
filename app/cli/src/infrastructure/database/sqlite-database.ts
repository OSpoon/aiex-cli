import type { DatabaseInsertResult, DatabaseTableRowsQuery, DatabaseTableRowsResult, ProjectDatabase } from '@/domain/database'
import type { JsonSchemaDefinition } from '@/domain/schema/schemas'
import type { MigrationConfig } from '@/domain/schema/types'
import fs from 'node:fs/promises'
import Database from 'better-sqlite3'
import { Kysely, sql, SqliteDialect } from 'kysely'
import { insertExtractedData } from '@/infrastructure/extraction/insert-extracted-data'

const INTERNAL_ROWID_COLUMN = '__aiex_rowid'

interface SqliteTableInfoRow {
  name: string
  type: string
  notnull: number
  pk: number
}

type DynamicDatabase = Record<string, Record<string, unknown>>

function createReadonlyQueryDb(databasePath: string): Kysely<DynamicDatabase> {
  return new Kysely<DynamicDatabase>({
    dialect: new SqliteDialect({
      database: new Database(databasePath, { readonly: true }),
    }),
  })
}

export class SqliteProjectDatabase implements ProjectDatabase {
  readonly dialect = 'sqlite' as const

  constructor(private readonly databasePath: string) {}

  async exists(): Promise<boolean> {
    try {
      const stat = await fs.stat(this.databasePath)
      return stat.isFile()
    }
    catch {
      return false
    }
  }

  async listTableNames(): Promise<string[]> {
    let db: Kysely<DynamicDatabase> | null = null
    try {
      db = createReadonlyQueryDb(this.databasePath)
      const tablesResult = await sql<{ name: string }>`
        select name
        from sqlite_master
        where type = 'table' and name not like 'sqlite_%' and name not like '_%'
        order by name
      `.execute(db)
      return tablesResult.rows.map(row => row.name)
    }
    finally {
      await db?.destroy()
    }
  }

  async verifyTables(tableNames: string[]): Promise<{ ok: boolean, missing: string[], error?: string }> {
    const db = new Database(this.databasePath, { readonly: true })
    try {
      const missing = tableNames.filter((table) => {
        const row = db.prepare(
          `SELECT name FROM sqlite_master WHERE type='table' AND name=?`,
        ).get(table)
        return !row
      })
      return { ok: missing.length === 0, missing }
    }
    catch (error) {
      return {
        ok: false,
        missing: [],
        error: error instanceof Error ? error.message : String(error),
      }
    }
    finally {
      db.close()
    }
  }

  insertExtracted(schema: JsonSchemaDefinition, data: Record<string, unknown>): DatabaseInsertResult {
    const db = new Database(this.databasePath)
    try {
      return insertExtractedData(db, schema, data)
    }
    finally {
      db.close()
    }
  }

  async readTableRows(query: DatabaseTableRowsQuery): Promise<DatabaseTableRowsResult> {
    const { tableName, page, pageSize, search, sortField, sortOrder, all } = query
    const db = createReadonlyQueryDb(this.databasePath)

    try {
      const tableExists = await sql<{ name: string }>`
        select name
        from sqlite_master
        where type = 'table' and name = ${tableName}
      `.execute(db)

      if (tableExists.rows.length === 0)
        throw new Error(`Table not found: ${tableName}`)

      const tableInfo = await sql<SqliteTableInfoRow>`
        pragma table_info(${sql.table(tableName)})
      `.execute(db)

      const columns = tableInfo.rows.map(col => ({
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
      const totalPages = all ? 1 : Math.max(1, Math.ceil(total / pageSize))

      const result = all
        ? await sql<Record<string, unknown>>`
            select rowid as ${sql.raw(INTERNAL_ROWID_COLUMN)}, *
            from ${sql.table(tableName)}
            ${searchCondition}
            ${orderBy}
          `.execute(db)
        : await sql<Record<string, unknown>>`
            select rowid as ${sql.raw(INTERNAL_ROWID_COLUMN)}, *
            from ${sql.table(tableName)}
            ${searchCondition}
            ${orderBy}
            limit ${pageSize}
            offset ${offset}
          `.execute(db)

      const rowIds = result.rows.map((row) => {
        const rowId = row[INTERNAL_ROWID_COLUMN]
        return rowId === null || rowId === undefined ? undefined : String(rowId)
      })
      const rows = result.rows.map(({ [INTERNAL_ROWID_COLUMN]: _rowid, ...row }) => row)

      return { columns, rows, rowIds, total, page, pageSize, totalPages }
    }
    finally {
      await db.destroy()
    }
  }
}

export function createProjectDatabase(config: MigrationConfig): ProjectDatabase {
  return new SqliteProjectDatabase(config.databasePath)
}
