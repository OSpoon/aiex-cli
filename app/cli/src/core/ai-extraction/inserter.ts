import type Database from 'better-sqlite3'
import type { JsonSchemaDefinition } from '@/core/schema-sqlite/schemas'
import type { ParsedColumn, ParsedTable, ParseResult } from '@/core/schema-sqlite/types'
import { parseJsonSchema, toSnakeCase } from '@/core/schema-sqlite'

const DRIZZLE_MODE_RE = /mode:\s*'(\w+)'/

export interface InsertResult {
  success: boolean
  tablesInserted: Array<{ table: string, rowId: number }>
  error?: string
}

function drizzleTypeToSql(type: string): string {
  if (type.startsWith('text'))
    return 'TEXT'
  if (type.startsWith('integer'))
    return 'INTEGER'
  if (type.startsWith('real'))
    return 'REAL'
  return 'TEXT'
}

function extractDrizzleMode(column: ParsedColumn): string | undefined {
  return column.drizzleType.match(DRIZZLE_MODE_RE)?.[1]
}

function convertValue(value: unknown, column: ParsedColumn): unknown {
  if (value === null || value === undefined)
    return null

  const mode = extractDrizzleMode(column)

  if (mode === 'json') {
    return typeof value === 'string' ? value : JSON.stringify(value)
  }
  if (mode === 'boolean') {
    return value ? 1 : 0
  }
  if (mode === 'timestamp' || mode === 'timestamp_ms') {
    if (typeof value === 'string') {
      const ms = Date.parse(value)
      if (Number.isNaN(ms))
        return value
      return mode === 'timestamp_ms' ? ms : Math.floor(ms / 1000)
    }
    return value
  }

  return value
}

function buildInsertSql(table: ParsedTable, data: Record<string, unknown>): { sql: string, values: unknown[] } {
  const columns: string[] = []
  const values: unknown[] = []

  for (const col of table.columns) {
    if (col.isAutoIncrement)
      continue

    const value = data[col.name]
    if (value === undefined) {
      if (col.defaultValue !== undefined) {
        columns.push(col.name)
        values.push(convertValue(JSON.parse(col.defaultValue), col))
      }
      continue
    }

    columns.push(col.name)
    values.push(convertValue(value, col))
  }

  const placeholders = values.map(() => '?').join(', ')
  const sql = `INSERT INTO ${table.name} (${columns.join(', ')}) VALUES (${placeholders})`
  return { sql, values }
}

function buildCreateTableSql(table: ParsedTable): string {
  const parts: string[] = []

  for (const col of table.columns) {
    let sql = `${col.name} ${drizzleTypeToSql(col.drizzleType)}`

    if (col.isPrimary)
      sql += ' PRIMARY KEY'
    if (col.isAutoIncrement)
      sql += ' AUTOINCREMENT'
    if (!col.isNullable && !col.isPrimary)
      sql += ' NOT NULL'
    if (col.isUnique)
      sql += ' UNIQUE'
    if (col.defaultValue !== undefined)
      sql += ` DEFAULT ${col.defaultValue}`
    if (col.isForeignKey && col.foreignKeyRef) {
      sql += ` REFERENCES ${col.foreignKeyRef.table}(${col.foreignKeyRef.column})`
    }

    parts.push(sql)
  }

  return `CREATE TABLE IF NOT EXISTS ${table.name} (${parts.join(', ')})`
}

interface InsertTableParams {
  db: Database.Database
  table: ParsedTable
  data: Record<string, unknown>
  parentRowId?: number
  foreignKeyColumn?: string
}

function insertTableRow({ db, table, data, parentRowId, foreignKeyColumn }: InsertTableParams): number {
  const rowData: Record<string, unknown> = { ...data }

  if (parentRowId !== undefined && foreignKeyColumn) {
    rowData[foreignKeyColumn] = parentRowId
  }

  const { sql, values } = buildInsertSql(table, rowData)
  const stmt = db.prepare(sql)
  const info = stmt.run(...values)
  return Number(info.lastInsertRowid)
}

interface HasTimestamps {
  table?: { timestamps?: boolean }
}

function parseDataByColumns(
  data: Record<string, unknown>,
  schema: HasTimestamps,
  table: ParsedTable,
): Record<string, unknown> {
  const result: Record<string, unknown> = {}

  if ('properties' in schema) {
    const s = schema as JsonSchemaDefinition
    for (const [propName, prop] of Object.entries(s.properties)) {
      if (prop.nested?.enabled)
        continue
      if (prop.type === 'array' && prop.items?.nested?.enabled)
        continue

      const colName = toSnakeCase(propName)
      if (table.columns.some(c => c.name === colName && c.isAutoIncrement))
        continue

      if (propName in data) {
        result[colName] = data[propName]
      }
    }
  }

  if (schema.table?.timestamps) {
    if (!('created_at' in result)) {
      result.created_at = Math.floor(Date.now() / 1000)
    }
    if (!('updated_at' in result)) {
      result.updated_at = Math.floor(Date.now() / 1000)
    }
  }

  return result
}

export function insertExtractedData(
  db: Database.Database,
  schema: JsonSchemaDefinition,
  data: Record<string, unknown>,
): InsertResult {
  const inserted: Array<{ table: string, rowId: number }> = []

  try {
    const parseResult: ParseResult = parseJsonSchema(schema)
    const mainTable = parseResult.tables[0]

    const insertTransaction = db.transaction(() => {
      const mainData = parseDataByColumns(data, schema, mainTable)
      const mainRowId = insertTableRow({ db, table: mainTable, data: mainData })
      inserted.push({ table: mainTable.name, rowId: mainRowId })

      for (const revRel of parseResult.reverseRelations) {
        const rel = parseResult.relations.find(
          r => r.fromTable === revRel.toTable && r.toTable === revRel.fromTable,
        )
        if (!rel)
          continue

        const propEntry = Object.entries(schema.properties)
          .find(([key]) => toSnakeCase(key) === revRel.name && key in data)
        if (!propEntry)
          continue

        const [propName] = propEntry
        const nestedValue = data[propName]
        if (nestedValue === null || nestedValue === undefined)
          continue

        const nestedTable = parseResult.tables.find(t => t.name === revRel.toTable)
        if (!nestedTable)
          continue

        if (revRel.type === 'has-one') {
          const nestedData = parseDataByColumns(
            nestedValue as Record<string, unknown>,
            schema.properties[propName] as unknown as JsonSchemaDefinition,
            nestedTable,
          )
          const rowId = insertTableRow({
            db,
            table: nestedTable,
            data: nestedData,
            parentRowId: mainRowId,
            foreignKeyColumn: rel.fromColumn,
          })
          inserted.push({ table: revRel.toTable, rowId })
        }
        else if (revRel.type === 'has-many') {
          const items = nestedValue as unknown[]
          for (const item of items) {
            const nestedData = parseDataByColumns(
              item as Record<string, unknown>,
              (schema.properties[propName] as any).items as JsonSchemaDefinition,
              nestedTable,
            )
            const rowId = insertTableRow({
              db,
              table: nestedTable,
              data: nestedData,
              parentRowId: mainRowId,
              foreignKeyColumn: rel.fromColumn,
            })
            inserted.push({ table: revRel.toTable, rowId })
          }
        }
      }

      return mainRowId
    })

    insertTransaction()
    return { success: true, tablesInserted: inserted }
  }
  catch (e) {
    return {
      success: false,
      tablesInserted: inserted,
      error: e instanceof Error ? e.message : String(e),
    }
  }
}

export function createTablesFromSchema(db: Database.Database, schema: JsonSchemaDefinition): void {
  const result = parseJsonSchema(schema)
  for (const table of result.tables) {
    const sql = buildCreateTableSql(table)
    db.exec(sql)
  }
}
