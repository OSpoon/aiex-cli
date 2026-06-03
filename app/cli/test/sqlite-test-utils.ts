import type Database from 'better-sqlite3'
import type { JsonSchemaDefinition } from '@/domain/schema/schemas'
import type { CheckConstraint, ColumnType, ParsedColumn, ParsedTable } from '@/domain/schema/types'
import { parseJsonSchema } from '@/domain/schema/parser'

function renderColumnTypeToSql(ct: ColumnType): string {
  switch (ct.class) {
    case 'text':
      return 'TEXT'
    case 'integer':
      return 'INTEGER'
    case 'real':
      return 'REAL'
  }
}

function renderDefaultToSql(value: unknown): string {
  if (typeof value === 'string')
    return `'${value.replace(/'/g, '\'\'')}'`
  if (typeof value === 'number')
    return String(value)
  if (typeof value === 'boolean')
    return value ? '1' : '0'
  if (value === null)
    return 'NULL'
  return `'${JSON.stringify(value)}'`
}

function renderSqlLiteral(value: string | number): string {
  return typeof value === 'number'
    ? String(value)
    : `'${value.replace(/'/g, '\'\'')}'`
}

function buildColumnSql(column: ParsedColumn): string {
  let sql = `${column.name} ${renderColumnTypeToSql(column.columnType)}`

  if (column.isPrimary)
    sql += ' PRIMARY KEY'
  if (column.isAutoIncrement)
    sql += ' AUTOINCREMENT'
  if (!column.isNullable && !column.isPrimary)
    sql += ' NOT NULL'
  if (column.isUnique)
    sql += ' UNIQUE'
  if (column.default !== undefined)
    sql += ` DEFAULT ${renderDefaultToSql(column.default)}`
  if (column.isForeignKey && column.foreignKeyRef)
    sql += ` REFERENCES ${column.foreignKeyRef.table}(${column.foreignKeyRef.column})`

  return sql
}

function renderCheckToSql(check: CheckConstraint): string {
  let expr: string
  switch (check.kind) {
    case 'min_length':
      expr = `length(${check.column}) >= ${check.value}`
      break
    case 'max_length':
      expr = `length(${check.column}) <= ${check.value}`
      break
    case 'min_value':
      expr = `${check.column} >= ${check.value}`
      break
    case 'max_value':
      expr = `${check.column} <= ${check.value}`
      break
    case 'enum_value': {
      const values = Array.isArray(check.value) ? check.value : []
      expr = `${check.column} IN (${values.map(renderSqlLiteral).join(', ')})`
      break
    }
  }
  return `CONSTRAINT ${check.name} CHECK(${expr})`
}

function buildCreateTableSql(table: ParsedTable): string {
  const columnDefs = table.columns.map(buildColumnSql)
  if (table.checks?.length) {
    const checkDefs = table.checks.map(renderCheckToSql)
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
