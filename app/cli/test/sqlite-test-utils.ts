import type Database from 'better-sqlite3'
import type { JsonSchemaDefinition } from '@/core/schema-sqlite/schemas'
import type { ParsedColumn, ParsedTable } from '@/core/schema-sqlite/types'
import { parseJsonSchema } from '@/core/schema-sqlite'

function drizzleTypeToSql(type: string): string {
  if (type.startsWith('text'))
    return 'TEXT'
  if (type.startsWith('integer'))
    return 'INTEGER'
  if (type.startsWith('real'))
    return 'REAL'
  return 'TEXT'
}

function buildColumnSql(column: ParsedColumn): string {
  let sql = `${column.name} ${drizzleTypeToSql(column.drizzleType)}`

  if (column.isPrimary)
    sql += ' PRIMARY KEY'
  if (column.isAutoIncrement)
    sql += ' AUTOINCREMENT'
  if (!column.isNullable && !column.isPrimary)
    sql += ' NOT NULL'
  if (column.isUnique)
    sql += ' UNIQUE'
  if (column.defaultValue !== undefined)
    sql += ` DEFAULT ${column.defaultValue}`
  if (column.isForeignKey && column.foreignKeyRef)
    sql += ` REFERENCES ${column.foreignKeyRef.table}(${column.foreignKeyRef.column})`

  return sql
}

function buildCreateTableSql(table: ParsedTable): string {
  return `CREATE TABLE IF NOT EXISTS ${table.name} (${table.columns.map(buildColumnSql).join(', ')})`
}

export function createTablesFromSchema(db: Database.Database, schema: JsonSchemaDefinition): void {
  const result = parseJsonSchema(schema)
  for (const table of result.tables) {
    db.exec(buildCreateTableSql(table))
  }
}
