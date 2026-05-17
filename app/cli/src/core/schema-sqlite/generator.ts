import type { ParsedColumn, ParsedRelation, ParsedReverseRelation, ParsedTable, ParseResult } from './types'

function generateColumnDefinition(column: ParsedColumn): string {
  if (column.isPrimary && column.isAutoIncrement) {
    return `  ${column.name}: integer().primaryKey({ autoIncrement: true })`
  }

  let def = `  ${column.name}: ${column.drizzleType}`

  if (column.isPrimary) {
    def += '.primaryKey()'
  }

  if (!column.isNullable && !column.isPrimary) {
    def += '.notNull()'
  }

  if (column.isUnique && !column.isPrimary) {
    def += '.unique()'
  }

  if (column.defaultValue !== undefined) {
    def += `.default(${column.defaultValue})`
  }

  // Foreign key reference
  if (column.isForeignKey && column.foreignKeyRef) {
    def += `.references(() => ${column.foreignKeyRef.table}.${column.foreignKeyRef.column})`
  }

  return def
}

function generateTableDefinition(table: ParsedTable): string {
  const columns = table.columns.map(generateColumnDefinition)
  return `export const ${table.name} = sqliteTable('${table.name}', {\n${columns.join(',\n')}\n})`
}

function generateRelationDefinitions(relations: ParsedRelation[], reverseRelations: ParsedReverseRelation[]): string {
  if (relations.length === 0 && reverseRelations.length === 0)
    return ''

  const definitions: string[] = []

  // Group child-side relations by table
  const childByTable = new Map<string, ParsedRelation[]>()
  for (const rel of relations) {
    const list = childByTable.get(rel.fromTable) ?? []
    list.push(rel)
    childByTable.set(rel.fromTable, list)
  }

  // Group parent-side relations by table
  const parentByTable = new Map<string, ParsedReverseRelation[]>()
  for (const rel of reverseRelations) {
    const list = parentByTable.get(rel.fromTable) ?? []
    list.push(rel)
    parentByTable.set(rel.fromTable, list)
  }

  // Collect all table names that have relations
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
      if (rel.type === 'has-many') {
        relDefs.push(`    ${rel.name}: many(${rel.toTable})`)
      }
      else {
        relDefs.push(`    ${rel.name}: one(${rel.toTable})`)
      }
    }

    definitions.push(`export const ${tableName}Relations = relations(${tableName}, ({ ${importStr} }) => ({\n${relDefs.join(',\n')}\n}))`)
  }

  return definitions.join('\n\n')
}

export function generateDrizzleSchema(result: ParseResult): string {
  const imports = `import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core'\nimport { relations } from 'drizzle-orm'`
  const tableDefs = result.tables.map(generateTableDefinition).join('\n\n')
  const relationDefs = generateRelationDefinitions(result.relations, result.reverseRelations)

  const parts = [imports, '', tableDefs]
  if (relationDefs) {
    parts.push('', relationDefs)
  }
  parts.push('')

  return parts.join('\n')
}
