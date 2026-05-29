import type Database from 'better-sqlite3'
import type { JsonSchemaDefinition } from '@/domain/schema/schemas'
import type { CheckConstraint, ParsedColumn, ParsedTable } from '@/domain/schema/types'
import { parseJsonSchema } from '@/domain/schema/parser'

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

function buildCheckSql(check: CheckConstraint): string {
  const expr = check.template.replace('%s', check.columns[0])
  return `CONSTRAINT ${check.name} CHECK(${expr})`
}

function buildCreateTableSql(table: ParsedTable): string {
  const columnDefs = table.columns.map(buildColumnSql)
  if (table.checks?.length) {
    const checkDefs = table.checks.map(buildCheckSql)
    return `CREATE TABLE IF NOT EXISTS ${table.name} (${[...columnDefs, ...checkDefs].join(', ')})`
  }
  return `CREATE TABLE IF NOT EXISTS ${table.name} (${columnDefs.join(', ')})`
}

export function createTablesFromSchema(db: Database.Database, schema: JsonSchemaDefinition): void {
  const result = parseJsonSchema(schema)
  for (const table of result.tables) {
    db.exec(buildCreateTableSql(table))
  }
}
