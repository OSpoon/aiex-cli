import type { JsonSchemaDefinition, JsonSchemaProperty } from './schemas'
import type { ParsedColumn, ParsedRelation, ParsedReverseRelation, ParsedTable, ParseResult } from './types'

export function toSnakeCase(str: string): string {
  return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`)
}

function mapPropertyToColumn(name: string, property: JsonSchemaProperty, isRequired: boolean): ParsedColumn {
  const snakeName = toSnakeCase(name)
  let drizzleType: string
  const isPrimary = property.primary ?? false
  const isAutoIncrement = property.autoIncrement ?? false

  switch (property.type) {
    case 'string': {
      const format = property.format
      if (format === 'date-time' || property.drizzle?.mode === 'timestamp') {
        drizzleType = `integer({ mode: 'timestamp' })`
      }
      else if (format === 'json' || property.drizzle?.mode === 'json') {
        drizzleType = `text({ mode: 'json' })`
      }
      else {
        drizzleType = 'text()'
      }
      break
    }
    case 'integer': {
      const mode = property.drizzle?.mode
      if (mode === 'boolean') {
        drizzleType = `integer({ mode: 'boolean' })`
      }
      else if (mode === 'timestamp' || mode === 'timestamp_ms') {
        drizzleType = `integer({ mode: '${mode}' })`
      }
      else if (mode === 'bigint') {
        drizzleType = `integer({ mode: 'bigint' })`
      }
      else {
        drizzleType = 'integer()'
      }
      break
    }
    case 'number':
      drizzleType = 'real()'
      break
    case 'boolean':
      drizzleType = `integer({ mode: 'boolean' })`
      break
    case 'object':
    case 'array':
      drizzleType = `text({ mode: 'json' })`
      break
    case 'null':
      drizzleType = 'text()'
      break
    default:
      drizzleType = 'text()'
  }

  return {
    name: snakeName,
    drizzleType,
    isPrimary,
    isAutoIncrement,
    isNullable: !isRequired && !isPrimary,
    isUnique: property.unique ?? false,
    defaultValue: property.default !== undefined ? JSON.stringify(property.default) : undefined,
    isForeignKey: property.foreignKey !== undefined,
    foreignKeyRef: property.foreignKey ?? undefined,
  }
}

function parseObjectToTable(
  schema: JsonSchemaDefinition,
  _warnings: string[],
): ParsedTable {
  const tableName = schema.table.name
  const columns: ParsedColumn[] = []
  const requiredFields = new Set(schema.required ?? [])
  const autoColumns = new Set<string>()

  if (schema.table.timestamps) {
    autoColumns.add('created_at')
    autoColumns.add('updated_at')
  }
  if (schema.table.softDelete) {
    autoColumns.add('deleted_at')
  }

  for (const [propName, prop] of Object.entries(schema.properties)) {
    if (prop.nested?.enabled && (prop.type === 'object' || prop.type === 'array')) {
      continue
    }
    if (prop.type === 'array' && prop.items?.nested?.enabled) {
      continue
    }
    const snakeName = toSnakeCase(propName)
    if (autoColumns.has(snakeName)) {
      continue
    }
    const isRequired = requiredFields.has(propName)
    const column = mapPropertyToColumn(propName, prop, isRequired)
    columns.push(column)
  }

  if (schema.table.timestamps) {
    columns.push({
      name: 'created_at',
      drizzleType: `integer({ mode: 'timestamp' })`,
      isPrimary: false,
      isAutoIncrement: false,
      isNullable: false,
      isUnique: false,
      defaultValue: undefined,
    })
    columns.push({
      name: 'updated_at',
      drizzleType: `integer({ mode: 'timestamp' })`,
      isPrimary: false,
      isAutoIncrement: false,
      isNullable: false,
      isUnique: false,
      defaultValue: undefined,
    })
  }

  if (schema.table.softDelete) {
    columns.push({
      name: 'deleted_at',
      drizzleType: `integer({ mode: 'timestamp' })`,
      isPrimary: false,
      isAutoIncrement: false,
      isNullable: true,
      isUnique: false,
      defaultValue: undefined,
    })
  }

  return { name: tableName, columns }
}

function parseNestedObject(
  propName: string,
  property: JsonSchemaProperty,
  parentTableName: string,
  warnings: string[],
): { table: ParsedTable, relation: ParsedRelation, reverseRelation: ParsedReverseRelation } {
  const nestedTableName = `${parentTableName}_${toSnakeCase(propName)}`
  const columns: ParsedColumn[] = []
  const relationType = property.nested?.relation === 'has-many' ? 'has-many' : 'has-one'

  columns.push({
    name: 'id',
    drizzleType: 'integer()',
    isPrimary: true,
    isAutoIncrement: true,
    isNullable: false,
    isUnique: false,
    defaultValue: undefined,
  })

  columns.push({
    name: `${parentTableName}_id`,
    drizzleType: 'integer()',
    isPrimary: false,
    isAutoIncrement: false,
    isNullable: false,
    isUnique: false,
    defaultValue: undefined,
    isForeignKey: true,
    foreignKeyRef: { table: parentTableName, column: 'id' },
  })

  if (property.type === 'object' && property.properties) {
    for (const [childName, childProp] of Object.entries(property.properties)) {
      if (childProp.nested?.enabled) {
        warnings.push(
          `Nested property "${childName}" inside "${nestedTableName}" is skipped — only one level of nesting is supported. Remove nested.enabled or use drizzle.mode: 'json' instead.`,
        )
        continue
      }
      const column = mapPropertyToColumn(childName, childProp, false)
      columns.push(column)
    }
  }

  const relation: ParsedRelation = {
    fromTable: nestedTableName,
    fromColumn: `${parentTableName}_id`,
    toTable: parentTableName,
    toColumn: 'id',
    name: parentTableName,
  }

  const reverseRelation: ParsedReverseRelation = {
    type: relationType,
    fromTable: parentTableName,
    toTable: nestedTableName,
    name: toSnakeCase(propName),
  }

  return { table: { name: nestedTableName, columns }, relation, reverseRelation }
}

export function parseJsonSchema(schema: JsonSchemaDefinition): ParseResult {
  const tables: ParsedTable[] = []
  const relations: ParsedRelation[] = []
  const reverseRelations: ParsedReverseRelation[] = []
  const warnings: string[] = []

  const mainTable = parseObjectToTable(schema, warnings)
  tables.push(mainTable)

  for (const [propName, prop] of Object.entries(schema.properties)) {
    if (prop.type === 'object' && prop.nested?.enabled) {
      const nested = parseNestedObject(propName, prop, mainTable.name, warnings)
      tables.push(nested.table)
      relations.push(nested.relation)
      reverseRelations.push(nested.reverseRelation)
    }
    else if (prop.type === 'array' && prop.items?.nested?.enabled && prop.items?.type === 'object' && prop.items.properties) {
      const nested = parseNestedObject(propName, prop.items, mainTable.name, warnings)
      tables.push(nested.table)
      relations.push(nested.relation)
      reverseRelations.push(nested.reverseRelation)
    }
  }

  return { tables, relations, reverseRelations, warnings }
}
