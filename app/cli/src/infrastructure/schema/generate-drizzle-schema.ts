import type { CheckConstraint, ColumnType, ParsedColumn, ParsedRelation, ParsedReverseRelation, ParsedTable, ParseResult } from '@/domain/schema/types'

function renderColumnType(ct: ColumnType): string {
  switch (ct.class) {
    case 'text':
      return ct.mode === 'json' ? `text({ mode: 'json' })` : 'text()'
    case 'integer':
      return ct.mode ? `integer({ mode: '${ct.mode}' })` : 'integer()'
    case 'real':
      return 'real()'
  }
}

function renderDefaultValue(value: unknown): string {
  return JSON.stringify(value)
}

function renderSqlLiteral(value: string | number): string {
  return typeof value === 'number'
    ? String(value)
    : `'${value.replace(/'/g, '\'\'')}'`
}

function generateColumnDefinition(column: ParsedColumn): string {
  if (column.isPrimary && column.isAutoIncrement) {
    return `  ${column.name}: integer().primaryKey({ autoIncrement: true })`
  }

  let def = `  ${column.name}: ${renderColumnType(column.columnType)}`

  if (column.isPrimary)
    def += '.primaryKey()'

  if (!column.isNullable && !column.isPrimary)
    def += '.notNull()'

  if (column.isUnique && !column.isPrimary)
    def += '.unique()'

  if (column.default !== undefined)
    def += `.default(${renderDefaultValue(column.default)})`

  if (column.isForeignKey && column.foreignKeyRef)
    def += `.references(() => ${column.foreignKeyRef.table}.${column.foreignKeyRef.column})`

  return def
}

function renderCheckToDrizzle(check: CheckConstraint, tableVar: string): string {
  const colRef = `\${${tableVar}.${check.column}}`
  let expr: string
  switch (check.kind) {
    case 'min_length':
      expr = `length(${colRef}) >= ${check.value}`
      break
    case 'max_length':
      expr = `length(${colRef}) <= ${check.value}`
      break
    case 'min_value':
      expr = `${colRef} >= ${check.value}`
      break
    case 'max_value':
      expr = `${colRef} <= ${check.value}`
      break
    case 'enum_value': {
      const values = Array.isArray(check.value) ? check.value : []
      expr = `${colRef} IN (${values.map(renderSqlLiteral).join(', ')})`
      break
    }
  }
  return `    ${check.name}: check('${check.name}', sql\`${expr}\`)`
}

function generateTableDefinition(table: ParsedTable): string {
  const columns = table.columns.map(generateColumnDefinition)

  if (!table.checks?.length) {
    return `export const ${table.name} = sqliteTable('${table.name}', {\n${columns.join(',\n')}\n})`
  }

  const checkLines = table.checks.map(c => renderCheckToDrizzle(c, 'table'))
  return `export const ${table.name} = sqliteTable('${table.name}', {\n${columns.join(',\n')}\n}, (table) => ({\n${checkLines.join(',\n')}\n}))`
}

function generateRelationDefinitions(relations: ParsedRelation[], reverseRelations: ParsedReverseRelation[]): string {
  if (relations.length === 0 && reverseRelations.length === 0)
    return ''

  const definitions: string[] = []

  const childByTable = new Map<string, ParsedRelation[]>()
  for (const rel of relations) {
    const list = childByTable.get(rel.fromTable) ?? []
    list.push(rel)
    childByTable.set(rel.fromTable, list)
  }

  const parentByTable = new Map<string, ParsedReverseRelation[]>()
  for (const rel of reverseRelations) {
    const list = parentByTable.get(rel.fromTable) ?? []
    list.push(rel)
    parentByTable.set(rel.fromTable, list)
  }

  const allTableNames = new Set([...childByTable.keys(), ...parentByTable.keys()])

  for (const tableName of allTableNames) {
    const childRels = childByTable.get(tableName) ?? []
    const parentRels = parentByTable.get(tableName) ?? []

    const needsOne = childRels.length > 0 || parentRels.some(r => r.type === 'has-one')
    const needsMany = parentRels.some(r => r.type === 'has-many')

    const imports: string[] = []
    if (needsOne)
      imports.push('one')
    if (needsMany)
      imports.push('many')
    const importStr = imports.join(', ')

    const relDefs: string[] = []

    for (const rel of childRels) {
      relDefs.push(`    ${rel.name}: one(${rel.toTable}, {\n      fields: [${rel.fromTable}.${rel.fromColumn}],\n      references: [${rel.toTable}.${rel.toColumn}],\n    })`)
    }

    for (const rel of parentRels) {
      if (rel.type === 'has-many')
        relDefs.push(`    ${rel.name}: many(${rel.toTable})`)
      else
        relDefs.push(`    ${rel.name}: one(${rel.toTable})`)
    }

    definitions.push(`export const ${tableName}Relations = relations(${tableName}, ({ ${importStr} }) => ({\n${relDefs.join(',\n')}\n}))`)
  }

  return definitions.join('\n\n')
}

export function generateDrizzleSchema(result: ParseResult): string {
  const hasChecks = result.tables.some(t => t.checks?.length)
  const sqliteCoreImports = `sqliteTable, text, integer, real${hasChecks ? ', check' : ''}`
  const drizzleImports = `relations${hasChecks ? ', sql' : ''}`
  const imports = `import { ${sqliteCoreImports} } from 'drizzle-orm/sqlite-core'\nimport { ${drizzleImports} } from 'drizzle-orm'`
  const tableDefs = result.tables.map(generateTableDefinition).join('\n\n')
  const relationDefs = generateRelationDefinitions(result.relations, result.reverseRelations)

  const parts = [imports, '', tableDefs]
  if (relationDefs)
    parts.push('', relationDefs)
  parts.push('')

  return parts.join('\n')
}
