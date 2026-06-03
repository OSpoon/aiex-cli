import type { SchemaMappingEntry } from '@/domain/schema/types'
import { describe, expect, it } from 'vitest'
import { analyzeMigrationRisk } from '@/domain/schema/migration-risk'

function entry(overrides: Partial<SchemaMappingEntry> = {}): SchemaMappingEntry {
  return {
    schemaPath: '$.properties.name',
    table: 'customers',
    column: 'name',
    drizzleType: 'text()',
    sqliteType: 'text',
    nullable: true,
    primary: false,
    unique: false,
    relation: 'root',
    notes: [],
    ...overrides,
  }
}

describe('migration risk analysis', () => {
  it('marks removed columns as high risk', () => {
    const report = analyzeMigrationRisk([
      entry({ column: 'name' }),
      entry({ column: 'email' }),
    ], [
      entry({ column: 'name' }),
    ])

    expect(report.level).toBe('high')
    expect(report.hasHighRisk).toBe(true)
    expect(report.items).toContainEqual(expect.objectContaining({
      severity: 'high',
      kind: 'column_removed',
      table: 'customers',
      column: 'email',
    }))
  })

  it('marks type changes and nullable tightening as high risk', () => {
    const report = analyzeMigrationRisk([
      entry({ column: 'age', drizzleType: 'integer()', sqliteType: 'integer', nullable: true }),
    ], [
      entry({ column: 'age', drizzleType: 'real()', sqliteType: 'real', nullable: false }),
    ])

    expect(report.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'column_type_changed', severity: 'high' }),
      expect.objectContaining({ kind: 'nullable_tightened', severity: 'high' }),
    ]))
  })

  it('marks enum narrowing as high risk', () => {
    const report = analyzeMigrationRisk([
      entry({ column: 'status', constraints: { enumValues: ['draft', 'paid', 'cancelled'] } }),
    ], [
      entry({ column: 'status', constraints: { enumValues: ['draft', 'paid'] } }),
    ])

    expect(report.items).toContainEqual(expect.objectContaining({
      kind: 'enum_narrowed',
      severity: 'high',
    }))
  })
})
