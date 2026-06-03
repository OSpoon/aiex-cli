import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parseAllSchemas } from '@/application/schema/parse-all-schemas'
import { generateSchemaFromFiles } from '@/application/schema/schema-sync'
import { createMigrationConfig } from '@/infrastructure/schema/migration-config'

describe('aiex Drizzle-backed schema dialect', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aiex-schema-dialect-'))
  })

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })

  it('warns for JSON Schema keywords that are outside the Drizzle-backed dialect', () => {
    const result = parseAllSchemas([
      {
        filePath: 'customer.json',
        content: JSON.stringify({
          title: 'Customer',
          type: 'object',
          table: { name: 'customers' },
          additionalProperties: false,
          properties: {
            status: {
              type: 'string',
              oneOf: [{ const: 'active' }],
            },
          },
        }),
      },
    ])

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.warnings).toEqual(expect.arrayContaining([
        expect.stringContaining('customer.json.additionalProperties'),
        expect.stringContaining('customer.json.properties.status.oneOf'),
      ]))
    }
  })

  it('rejects format values that are outside the Drizzle-backed dialect', () => {
    const result = parseAllSchemas([
      {
        filePath: 'customer.json',
        content: JSON.stringify({
          title: 'Customer',
          type: 'object',
          table: { name: 'customers' },
          properties: {
            birthday: { type: 'string', format: 'date' },
          },
        }),
      },
    ])

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error).toContain('customer.json')
      expect(result.error).toContain('properties.birthday.format')
    }
  })

  it('rejects drizzle options that are not emitted by the generator', () => {
    const result = parseAllSchemas([
      {
        filePath: 'customer.json',
        content: JSON.stringify({
          title: 'Customer',
          type: 'object',
          table: { name: 'customers' },
          properties: {
            metadata: { type: 'object', drizzle: { customType: 'jsonb' } },
          },
        }),
      },
    ])

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error).toContain('customer.json')
      expect(result.error).toContain('properties.metadata.drizzle')
    }
  })

  it('rejects property names that cannot be emitted as stable Drizzle columns', () => {
    const result = parseAllSchemas([
      {
        filePath: 'customer.json',
        content: JSON.stringify({
          title: 'Customer',
          type: 'object',
          table: { name: 'customers' },
          properties: {
            'full name': { type: 'string' },
          },
        }),
      },
    ])

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error).toContain('customer.json')
      expect(result.error).toContain('properties.full name')
    }
  })

  it('emits enum as a SQLite check constraint and warns for non-portable pattern constraints', () => {
    const result = parseAllSchemas([
      {
        filePath: 'order.json',
        content: JSON.stringify({
          title: 'Order',
          type: 'object',
          table: { name: 'orders' },
          properties: {
            status: { type: 'string', enum: ['pending', 'paid'] },
            code: { type: 'string', pattern: '^ORD-\\d+$' },
          },
        }),
      },
    ])

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.drizzleCode).toContain('status_enum')
      expect(result.data.drizzleCode).toContain(`\${table.status} IN (`)
      expect(result.data.drizzleCode).toContain('\'pending\', \'paid\'')
      expect(result.data.warnings).toContain('$.properties.code.pattern is kept for extraction guidance but is not emitted as a SQLite constraint because SQLite has no portable REGEXP support.')
    }
  })

  it('maps required nested object fields to non-null child table columns', () => {
    const result = parseAllSchemas([
      {
        filePath: 'customer.json',
        content: JSON.stringify({
          title: 'Customer',
          type: 'object',
          table: { name: 'customers' },
          properties: {
            id: { type: 'integer', primary: true },
            address: {
              type: 'object',
              nested: { enabled: true, relation: 'has-one' },
              properties: {
                city: { type: 'string' },
                country: { type: 'string' },
              },
              required: ['city'],
            },
          },
        }),
      },
    ])

    expect(result.success).toBe(true)
    if (result.success) {
      const addressTable = result.data.tables.find(table => table.name === 'customers_address')
      expect(addressTable?.columns.find(column => column.name === 'city')?.isNullable).toBe(false)
      expect(addressTable?.columns.find(column => column.name === 'country')?.isNullable).toBe(true)
      expect(result.data.drizzleCode).toContain('city: text().notNull()')
    }
  })

  it('writes a schema-to-Drizzle mapping report during schema generation', async () => {
    const config = createMigrationConfig(tempDir)
    fs.mkdirSync(config.schemaPath, { recursive: true })
    const schemaPath = path.join(config.schemaPath, 'customer.json')
    fs.writeFileSync(schemaPath, JSON.stringify({
      title: 'Customer',
      type: 'object',
      table: { name: 'customers', timestamps: true },
      properties: {
        id: { type: 'integer', primary: true, autoIncrement: true },
        email: { type: 'string', unique: true },
        metadata: { type: 'object', drizzle: { mode: 'json' } },
      },
      required: ['email'],
    }))

    const result = await generateSchemaFromFiles([schemaPath], config)

    expect(result.success).toBe(true)
    expect(result.mappingEntries).toBeGreaterThanOrEqual(4)

    const reportPath = path.join(path.dirname(config.drizzleSchemaPath), 'schema-map.json')
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf-8')) as {
      dialect: string
      entries: Array<{ schemaPath: string, table: string, column: string, drizzleType: string, notes: string[] }>
    }

    expect(report.dialect).toBe('aiex-drizzle-sqlite')
    expect(report.entries).toContainEqual(expect.objectContaining({
      schemaPath: `${schemaPath}.properties.email`,
      table: 'customers',
      column: 'email',
      drizzleType: 'text()',
    }))
    expect(report.entries).toContainEqual(expect.objectContaining({
      schemaPath: `${schemaPath}.properties.metadata`,
      table: 'customers',
      column: 'metadata',
      drizzleType: `text({ mode: 'json' })`,
      notes: expect.arrayContaining(['stored_as_json', 'drizzle_mode:json']),
    }))
  })
})
