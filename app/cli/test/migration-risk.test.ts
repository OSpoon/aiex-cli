import type { SchemaMappingEntry } from '@/domain/schema/types'
import { describe, expect, it } from 'vitest'
import { analyzeMigrationRisk } from '@/domain/schema/migration-risk'

function entry(overrides: Partial<SchemaMappingEntry> = {}): SchemaMappingEntry {
  return {
    schemaPath: '$.properties.name',
    table: 'customers',
    column: 'name',
    drizzleType: 'text()',
    databaseType: 'text',
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
      entry({ column: 'age', drizzleType: 'integer()', databaseType: 'integer', nullable: true }),
    ], [
      entry({ column: 'age', drizzleType: 'real()', databaseType: 'real', nullable: false }),
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

  it('marks tightened CHECK constraints as high risk', () => {
    const report = analyzeMigrationRisk([
      entry({
        column: 'name',
        constraints: { minLength: 2, maxLength: 100 },
      }),
      entry({
        column: 'score',
        databaseType: 'real',
        drizzleType: 'real()',
        constraints: { minimum: 0, maximum: 100 },
      }),
    ], [
      entry({
        column: 'name',
        constraints: { minLength: 3, maxLength: 80 },
      }),
      entry({
        column: 'score',
        databaseType: 'real',
        drizzleType: 'real()',
        constraints: { minimum: 10, maximum: 90 },
      }),
    ])

    expect(report.level).toBe('high')
    expect(report.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ column: 'name', kind: 'constraint_tightened', severity: 'high' }),
      expect.objectContaining({ column: 'score', kind: 'constraint_tightened', severity: 'high' }),
    ]))
  })

  it('marks relaxed CHECK constraints and default changes as medium risk', () => {
    const report = analyzeMigrationRisk([
      entry({
        column: 'name',
        constraints: { minLength: 3, maxLength: 80 },
        defaultValue: 'unknown',
      }),
    ], [
      entry({
        column: 'name',
        constraints: { minLength: 2, maxLength: 100 },
        defaultValue: 'anonymous',
      }),
    ])

    expect(report.level).toBe('medium')
    expect(report.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'constraint_changed', severity: 'medium' }),
      expect.objectContaining({ kind: 'default_changed', severity: 'medium' }),
    ]))
  })

  it('marks foreign key changes as high risk', () => {
    const report = analyzeMigrationRisk([
      entry({
        column: 'customer_id',
        databaseType: 'integer',
        drizzleType: 'integer().references(...)',
        foreignKey: { table: 'customers', column: 'id' },
      }),
    ], [
      entry({
        column: 'customer_id',
        databaseType: 'integer',
        drizzleType: 'integer().references(...)',
        foreignKey: { table: 'accounts', column: 'id' },
      }),
    ])

    expect(report.level).toBe('high')
    expect(report.items).toContainEqual(expect.objectContaining({
      column: 'customer_id',
      kind: 'foreign_key_changed',
      severity: 'high',
    }))
  })
})
