import type { JsonSchemaDefinition, JsonSchemaProperty } from './schemas'
import type { CheckConstraint, ColumnType, ParsedColumn, ParsedRelation, ParsedReverseRelation, ParsedTable, ParseResult, SchemaMappingEntry } from './types'

export function toSnakeCase(str: string): string {
  return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`)
}

export function columnTypeText(mode?: 'json'): ColumnType {
  return mode ? { class: 'text', mode } : { class: 'text' }
}

export function columnTypeInteger(mode?: 'boolean' | 'timestamp' | 'timestamp_ms' | 'bigint'): ColumnType {
  return mode ? { class: 'integer', mode } : { class: 'integer' }
}

export function columnTypeReal(): ColumnType {
  return { class: 'real' }
}

function mapColumnType(property: JsonSchemaProperty): ColumnType {
  switch (property.type) {
    case 'string': {
      const format = property.format
      if (format === 'date-time' || property.drizzle?.mode === 'timestamp')
        return { class: 'integer', mode: 'timestamp' }
      if (format === 'json' || property.drizzle?.mode === 'json')
        return { class: 'text', mode: 'json' }
      return { class: 'text' }
    }
    case 'integer': {
      const mode = property.drizzle?.mode
      if (mode === 'boolean' || mode === 'timestamp' || mode === 'timestamp_ms' || mode === 'bigint')
        return { class: 'integer', mode }
      return { class: 'integer' }
    }
    case 'number':
      return { class: 'real' }
    case 'boolean':
      return { class: 'integer', mode: 'boolean' }
    case 'object':
    case 'array':
      return { class: 'text', mode: 'json' }
    case 'null':
    default:
      return { class: 'text' }
  }
}

function mapPropertyToColumn(name: string, property: JsonSchemaProperty, isRequired: boolean): ParsedColumn {
  return {
    name: toSnakeCase(name),
    columnType: mapColumnType(property),
    isPrimary: property.primary ?? false,
    isAutoIncrement: property.autoIncrement ?? false,
    isNullable: !isRequired && !property.primary,
    isUnique: property.unique ?? false,
    default: property.default,
    isForeignKey: property.foreignKey !== undefined,
    foreignKeyRef: property.foreignKey ?? undefined,
  }
}

function getColumnChecks(prop: JsonSchemaProperty, colName: string): CheckConstraint[] {
  const checks: CheckConstraint[] = []

  if (prop.type === 'string') {
    if (prop.minLength !== undefined && prop.minLength > 0)
      checks.push({ name: `${colName}_min_length`, column: colName, kind: 'min_length', value: prop.minLength })
    if (prop.maxLength !== undefined)
      checks.push({ name: `${colName}_max_length`, column: colName, kind: 'max_length', value: prop.maxLength })
  }

  if (prop.type === 'integer' || prop.type === 'number') {
    if (prop.minimum !== undefined)
      checks.push({ name: `${colName}_min`, column: colName, kind: 'min_value', value: prop.minimum })
    if (prop.maximum !== undefined)
      checks.push({ name: `${colName}_max`, column: colName, kind: 'max_value', value: prop.maximum })
  }

  if (prop.enum?.length)
    checks.push({ name: `${colName}_enum`, column: colName, kind: 'enum_value', value: prop.enum })

  return checks
}

function warnNonDrizzleBackedProperty(
  warnings: string[],
  schemaPath: string,
  property: JsonSchemaProperty,
): void {
  if (property.pattern) {
    warnings.push(
      `${schemaPath}.pattern is kept for extraction guidance but is not emitted as a SQLite constraint because SQLite has no portable REGEXP support.`,
    )
  }
}

function describeColumnType(columnType: ColumnType): { drizzleType: string, databaseType: 'text' | 'integer' | 'real' } {
  switch (columnType.class) {
    case 'text':
      return {
        drizzleType: columnType.mode === 'json' ? `text({ mode: 'json' })` : 'text()',
        databaseType: 'text',
      }
    case 'integer':
      return {
        drizzleType: columnType.mode ? `integer({ mode: '${columnType.mode}' })` : 'integer()',
        databaseType: 'integer',
      }
    case 'real':
      return { drizzleType: 'real()', databaseType: 'real' }
  }
}

function columnNotes(property: JsonSchemaProperty, column: ParsedColumn): string[] {
  const notes: string[] = []
  if (property.type === 'object' || property.type === 'array')
    notes.push('stored_as_json')
  if (property.format === 'date-time')
    notes.push('date_time_as_timestamp')
  if (property.drizzle?.mode)
    notes.push(`drizzle_mode:${property.drizzle.mode}`)
  if (property.foreignKey)
    notes.push(`foreign_key:${property.foreignKey.table}.${property.foreignKey.column}`)
  if (column.default !== undefined)
    notes.push('default')
  return notes
}

function propertyConstraints(property: JsonSchemaProperty): SchemaMappingEntry['constraints'] {
  const constraints: NonNullable<SchemaMappingEntry['constraints']> = {}

  if (property.enum?.length)
    constraints.enumValues = property.enum
  if (property.minLength !== undefined)
    constraints.minLength = property.minLength
  if (property.maxLength !== undefined)
    constraints.maxLength = property.maxLength
  if (property.minimum !== undefined)
    constraints.minimum = property.minimum
  if (property.maximum !== undefined)
    constraints.maximum = property.maximum

  return Object.keys(constraints).length > 0 ? constraints : undefined
}

function mapColumnToReport(
  schemaPath: string,
  table: string,
  property: JsonSchemaProperty,
  column: ParsedColumn,
  relation: SchemaMappingEntry['relation'],
): SchemaMappingEntry {
  const columnType = describeColumnType(column.columnType)
  return {
    schemaPath,
    table,
    column: column.name,
    drizzleType: columnType.drizzleType,
    databaseType: columnType.databaseType,
    nullable: column.isNullable,
    primary: column.isPrimary,
    unique: column.isUnique,
    relation,
    constraints: propertyConstraints(property),
    defaultValue: column.default,
    foreignKey: column.foreignKeyRef,
    notes: columnNotes(property, column),
  }
}

function parseObjectToTable(
  schema: JsonSchemaDefinition,
  warnings: string[],
  mapping: SchemaMappingEntry[],
): ParsedTable {
  const tableName = schema.table.name
  const columns: ParsedColumn[] = []
  const checks: CheckConstraint[] = []
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
    checks.push(...getColumnChecks(prop, column.name))
    warnNonDrizzleBackedProperty(warnings, `$.properties.${propName}`, prop)
    mapping.push(mapColumnToReport(`$.properties.${propName}`, tableName, prop, column, 'root'))
  }

  if (schema.table.timestamps) {
    const tsCol: ParsedColumn = { name: 'created_at', columnType: { class: 'integer', mode: 'timestamp' }, isPrimary: false, isAutoIncrement: false, isNullable: false, isUnique: false }
    columns.push(tsCol)
    columns.push({ ...tsCol, name: 'updated_at' })
    mapping.push(mapColumnToReport('$.table.timestamps.createdAt', tableName, { type: 'integer', drizzle: { mode: 'timestamp' } }, tsCol, 'root'))
    mapping.push(mapColumnToReport('$.table.timestamps.updatedAt', tableName, { type: 'integer', drizzle: { mode: 'timestamp' } }, { ...tsCol, name: 'updated_at' }, 'root'))
  }

  if (schema.table.softDelete) {
    const deletedAt: ParsedColumn = { name: 'deleted_at', columnType: { class: 'integer', mode: 'timestamp' }, isPrimary: false, isAutoIncrement: false, isNullable: true, isUnique: false }
    columns.push(deletedAt)
    mapping.push(mapColumnToReport('$.table.softDelete.deletedAt', tableName, { type: 'integer', drizzle: { mode: 'timestamp' } }, deletedAt, 'root'))
  }

  return checks.length > 0 ? { name: tableName, columns, checks } : { name: tableName, columns }
}

function parseNestedObject(
  propName: string,
  property: JsonSchemaProperty,
  parentTableName: string,
  warnings: string[],
  mapping: SchemaMappingEntry[],
): { table: ParsedTable, relation: ParsedRelation, reverseRelation: ParsedReverseRelation } {
  const nestedTableName = `${parentTableName}_${toSnakeCase(propName)}`
  const columns: ParsedColumn[] = []
  const checks: CheckConstraint[] = []
  const relationType = property.nested?.relation === 'has-many' ? 'has-many' : 'has-one'
  const requiredFields = new Set(property.required ?? [])

  columns.push({
    name: 'id',
    columnType: { class: 'integer' },
    isPrimary: true,
    isAutoIncrement: true,
    isNullable: false,
    isUnique: false,
  })
  mapping.push({
    schemaPath: `$.properties.${propName}.id`,
    table: nestedTableName,
    column: 'id',
    drizzleType: 'integer().primaryKey({ autoIncrement: true })',
    databaseType: 'integer',
    nullable: false,
    primary: true,
    unique: false,
    relation: relationType,
    defaultValue: undefined,
    foreignKey: undefined,
    notes: ['generated_nested_primary_key'],
  })

  columns.push({
    name: `${parentTableName}_id`,
    columnType: { class: 'integer' },
    isPrimary: false,
    isAutoIncrement: false,
    isNullable: false,
    isUnique: false,
    isForeignKey: true,
    foreignKeyRef: { table: parentTableName, column: 'id' },
  })
  mapping.push({
    schemaPath: `$.properties.${propName}.${parentTableName}Id`,
    table: nestedTableName,
    column: `${parentTableName}_id`,
    drizzleType: 'integer().references(...)',
    databaseType: 'integer',
    nullable: false,
    primary: false,
    unique: false,
    relation: relationType,
    defaultValue: undefined,
    foreignKey: { table: parentTableName, column: 'id' },
    notes: [`generated_parent_foreign_key:${parentTableName}.id`],
  })

  if (property.type === 'object' && property.properties) {
    for (const [childName, childProp] of Object.entries(property.properties)) {
      if (childProp.nested?.enabled) {
        warnings.push(
          `Nested property "${childName}" inside "${nestedTableName}" is skipped — only one level of nesting is supported. Remove nested.enabled or use drizzle.mode: 'json' instead.`,
        )
        continue
      }
      const column = mapPropertyToColumn(childName, childProp, requiredFields.has(childName))
      columns.push(column)
      checks.push(...getColumnChecks(childProp, column.name))
      warnNonDrizzleBackedProperty(warnings, `$.properties.${propName}.properties.${childName}`, childProp)
      mapping.push(mapColumnToReport(`$.properties.${propName}.properties.${childName}`, nestedTableName, childProp, column, relationType))
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

  const table: ParsedTable = checks.length > 0 ? { name: nestedTableName, columns, checks } : { name: nestedTableName, columns }
  return { table, relation, reverseRelation }
}

export function parseJsonSchema(schema: JsonSchemaDefinition): ParseResult {
  const tables: ParsedTable[] = []
  const relations: ParsedRelation[] = []
  const reverseRelations: ParsedReverseRelation[] = []
  const warnings: string[] = []
  const mapping: SchemaMappingEntry[] = []

  const mainTable = parseObjectToTable(schema, warnings, mapping)
  tables.push(mainTable)

  for (const [propName, prop] of Object.entries(schema.properties)) {
    if (prop.type === 'object' && prop.nested?.enabled) {
      const nested = parseNestedObject(propName, prop, mainTable.name, warnings, mapping)
      tables.push(nested.table)
      relations.push(nested.relation)
      reverseRelations.push(nested.reverseRelation)
    }
    else if (prop.type === 'array' && prop.items?.nested?.enabled && prop.items?.type === 'object' && prop.items.properties) {
      const nested = parseNestedObject(propName, prop.items, mainTable.name, warnings, mapping)
      tables.push(nested.table)
      relations.push(nested.relation)
      reverseRelations.push(nested.reverseRelation)
    }
  }

  return { tables, relations, reverseRelations, warnings, mapping }
}
