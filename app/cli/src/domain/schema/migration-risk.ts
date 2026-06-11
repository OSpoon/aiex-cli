import type { MigrationRiskItem, MigrationRiskReport, MigrationRiskSeverity, SchemaMappingEntry } from './types'

function keyOf(entry: SchemaMappingEntry): string {
  return `${entry.table}.${entry.column}`
}

function maxSeverity(items: MigrationRiskItem[]): MigrationRiskReport['level'] {
  if (items.some(item => item.severity === 'high'))
    return 'high'
  if (items.some(item => item.severity === 'medium'))
    return 'medium'
  if (items.some(item => item.severity === 'low'))
    return 'low'
  return 'none'
}

function addRisk(
  items: MigrationRiskItem[],
  severity: MigrationRiskSeverity,
  kind: MigrationRiskItem['kind'],
  table: string,
  column: string | undefined,
  message: string,
): void {
  items.push({ severity, kind, table, column, message })
}

function enumValues(entry: SchemaMappingEntry): Set<string> {
  return new Set((entry.constraints?.enumValues ?? []).map(value => JSON.stringify(value)))
}

function isEnumNarrowed(previous: SchemaMappingEntry, next: SchemaMappingEntry): boolean {
  const prev = enumValues(previous)
  const current = enumValues(next)
  if (prev.size === 0 || current.size === 0 || current.size >= prev.size)
    return false
  return [...current].every(value => prev.has(value))
}

function enumChanged(previous: SchemaMappingEntry, next: SchemaMappingEntry): boolean {
  const prev = enumValues(previous)
  const current = enumValues(next)
  if (prev.size === 0 && current.size === 0)
    return false
  if (prev.size !== current.size)
    return true
  return [...prev].some(value => !current.has(value))
}

function stableJson(value: unknown): string {
  return JSON.stringify(value)
}

function changed(previous: unknown, next: unknown): boolean {
  return stableJson(previous) !== stableJson(next)
}

function constraintValue(entry: SchemaMappingEntry, key: keyof NonNullable<SchemaMappingEntry['constraints']>): number | undefined {
  const value = entry.constraints?.[key]
  return typeof value === 'number' ? value : undefined
}

function isLowerBoundTightened(previous: number | undefined, next: number | undefined): boolean {
  if (next === undefined)
    return false
  if (previous === undefined)
    return true
  return next > previous
}

function isUpperBoundTightened(previous: number | undefined, next: number | undefined): boolean {
  if (next === undefined)
    return false
  if (previous === undefined)
    return true
  return next < previous
}

function compareConstraint(
  items: MigrationRiskItem[],
  previous: SchemaMappingEntry,
  next: SchemaMappingEntry,
  key: 'minLength' | 'minimum' | 'maxLength' | 'maximum',
  tightened: (previous: number | undefined, next: number | undefined) => boolean,
): void {
  const previousValue = constraintValue(previous, key)
  const nextValue = constraintValue(next, key)
  if (previousValue === nextValue)
    return

  const severity: MigrationRiskSeverity = tightened(previousValue, nextValue) ? 'high' : 'medium'
  addRisk(
    items,
    severity,
    severity === 'high' ? 'constraint_tightened' : 'constraint_changed',
    previous.table,
    previous.column,
    `Column "${keyOf(previous)}" ${key} changes from ${previousValue ?? 'none'} to ${nextValue ?? 'none'}.`,
  )
}

function foreignKeyChanged(previous: SchemaMappingEntry, next: SchemaMappingEntry): boolean {
  return changed(previous.foreignKey, next.foreignKey)
}

export function analyzeMigrationRisk(
  previousEntries: SchemaMappingEntry[],
  nextEntries: SchemaMappingEntry[],
): MigrationRiskReport {
  const items: MigrationRiskItem[] = []
  const previousByKey = new Map(previousEntries.map(entry => [keyOf(entry), entry]))
  const nextByKey = new Map(nextEntries.map(entry => [keyOf(entry), entry]))
  const previousTables = new Set(previousEntries.map(entry => entry.table))
  const nextTables = new Set(nextEntries.map(entry => entry.table))

  for (const table of previousTables) {
    if (!nextTables.has(table))
      addRisk(items, 'high', 'table_removed', table, undefined, `Table "${table}" will be removed.`)
  }

  for (const table of nextTables) {
    if (!previousTables.has(table))
      addRisk(items, 'low', 'table_added', table, undefined, `Table "${table}" will be added.`)
  }

  for (const [key, previous] of previousByKey) {
    const next = nextByKey.get(key)
    if (!next) {
      addRisk(items, 'high', 'column_removed', previous.table, previous.column, `Column "${key}" will be removed.`)
      continue
    }

    if (previous.databaseType !== next.databaseType || previous.drizzleType !== next.drizzleType) {
      addRisk(
        items,
        'high',
        'column_type_changed',
        previous.table,
        previous.column,
        `Column "${key}" type changes from ${previous.drizzleType} to ${next.drizzleType}.`,
      )
    }

    if (previous.nullable && !next.nullable) {
      addRisk(items, 'high', 'nullable_tightened', previous.table, previous.column, `Column "${key}" changes from nullable to not null.`)
    }
    else if (!previous.nullable && next.nullable) {
      addRisk(items, 'medium', 'nullable_relaxed', previous.table, previous.column, `Column "${key}" changes from not null to nullable.`)
    }

    if (!previous.unique && next.unique)
      addRisk(items, 'high', 'unique_added', previous.table, previous.column, `Column "${key}" adds a unique constraint.`)

    if (previous.primary !== next.primary)
      addRisk(items, 'high', 'primary_changed', previous.table, previous.column, `Column "${key}" primary key status changes.`)

    if (isEnumNarrowed(previous, next)) {
      addRisk(items, 'high', 'enum_narrowed', previous.table, previous.column, `Column "${key}" enum values are narrowed.`)
    }
    else if (enumChanged(previous, next)) {
      addRisk(items, 'medium', 'enum_changed', previous.table, previous.column, `Column "${key}" enum values change.`)
    }

    compareConstraint(items, previous, next, 'minLength', isLowerBoundTightened)
    compareConstraint(items, previous, next, 'minimum', isLowerBoundTightened)
    compareConstraint(items, previous, next, 'maxLength', isUpperBoundTightened)
    compareConstraint(items, previous, next, 'maximum', isUpperBoundTightened)

    if (changed(previous.defaultValue, next.defaultValue)) {
      addRisk(
        items,
        'medium',
        'default_changed',
        previous.table,
        previous.column,
        `Column "${key}" default value changes.`,
      )
    }

    if (foreignKeyChanged(previous, next)) {
      addRisk(
        items,
        'high',
        'foreign_key_changed',
        previous.table,
        previous.column,
        `Column "${key}" foreign key changes.`,
      )
    }
  }

  for (const [key, next] of nextByKey) {
    if (!previousByKey.has(key))
      addRisk(items, next.nullable ? 'low' : 'medium', 'column_added', next.table, next.column, `Column "${key}" will be added.`)
  }

  const level = maxSeverity(items)
  return { level, items, hasHighRisk: level === 'high' }
}
