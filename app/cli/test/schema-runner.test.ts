import type { JsonSchemaDefinition } from '@/domain/schema/schemas'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  generateSchemaFromFiles,
  listSchemaFiles,
  parseMigrationOutput,
  runSchemaSync,
} from '@/application/schema/schema-sync'
import { insertExtractedData } from '@/infrastructure/extraction/insert-extracted-data'
import { createMigrationConfig } from '@/infrastructure/schema/migration-config'

const originalCwd = process.cwd()
const cleanupDirs = new Set<string>()

function createProjectFixture(): string {
  const dir = path.join(os.tmpdir(), `test-schema-runner-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  cleanupDirs.add(dir)
  fs.mkdirSync(path.join(dir, '.aiex', 'schema'), { recursive: true })
  return dir
}

function cleanupAllTestDirs(): void {
  for (const dir of [...cleanupDirs]) {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    cleanupDirs.delete(dir)
  }
}

function writeSchema(projectDir: string, fileName: string, schema: JsonSchemaDefinition): string {
  const schemaPath = path.join(projectDir, '.aiex', 'schema', fileName)
  fs.writeFileSync(schemaPath, `${JSON.stringify(schema, null, 2)}\n`)
  return schemaPath
}

function createInvoiceSchema(): JsonSchemaDefinition {
  return {
    title: 'Invoice',
    type: 'object',
    table: { name: 'invoices', timestamps: true, softDelete: true },
    properties: {
      id: { type: 'integer', primary: true, autoIncrement: true },
      invoiceNo: { type: 'string', unique: true, minLength: 3, maxLength: 32 },
      totalAmount: { type: 'number', minimum: 0 },
      paid: { type: 'boolean', default: false },
      issuedAt: { type: 'string', format: 'date-time' },
      metadata: { type: 'object', drizzle: { mode: 'json' } },
      lines: {
        type: 'array',
        items: {
          type: 'object',
          nested: { enabled: true, relation: 'has-many' },
          properties: {
            description: { type: 'string', minLength: 1 },
            quantity: { type: 'integer', minimum: 1 },
            unitPrice: { type: 'number', minimum: 0 },
          },
          required: ['description', 'quantity'],
        },
      },
    },
    required: ['invoiceNo', 'totalAmount'],
  }
}

function createWebEditorEcommerceSchema(): JsonSchemaDefinition {
  return {
    $schema: 'https://aiex.dev/schemas/table-schema.json',
    title: 'Customers',
    type: 'object',
    table: { name: 'customers', timestamps: true, softDelete: true },
    properties: {
      id: { type: 'integer', primary: true, autoIncrement: true },
      email: { type: 'string', format: 'email', unique: true },
      name: { type: 'string' },
      creditBalance: { type: 'number', default: 0 },
      isActive: { type: 'boolean', default: true },
      lastLoginAt: { type: 'string', format: 'date-time' },
      metadata: { type: 'object', drizzle: { mode: 'json' } },
      orders: {
        type: 'array',
        items: {
          type: 'object',
          nested: { enabled: true, relation: 'has-many' },
          properties: {
            orderNumber: { type: 'string', unique: true },
            status: { type: 'string', default: 'pending' },
            totalAmount: { type: 'number' },
            paidAt: { type: 'string', format: 'date-time' },
            notes: { type: 'string' },
          },
        },
      },
      address: {
        type: 'object',
        nested: { enabled: true, relation: 'has-one' },
        properties: {
          street: { type: 'string' },
          city: { type: 'string' },
          zipCode: { type: 'string' },
          country: { type: 'string' },
          isDefault: { type: 'boolean', default: false },
        },
      },
    },
    required: ['email', 'name'],
  }
}

describe('schema-runner', () => {
  describe('parseMigrationOutput', () => {
    it('parses valid JSON migration result from stdout', () => {
      const stdout = 'line1\n{"success":true,"changes":3,"tag":"m001_person"}\nline3'
      const result = parseMigrationOutput(stdout, '')
      expect(result.success).toBe(true)
      expect(result.changes).toBe(3)
      expect(result.tag).toBe('m001_person')
    })

    it('parses failed migration result', () => {
      const stdout = '{"success":false,"error":"Table already exists"}'
      const result = parseMigrationOutput(stdout, '')
      expect(result.success).toBe(false)
      expect(result.error).toBe('Table already exists')
    })

    it('returns error when no JSON line is found', () => {
      const stdout = 'Just some output\nNo JSON here'
      const result = parseMigrationOutput(stdout, '')
      expect(result.success).toBe(false)
      expect(result.error).toBe('Migration helper did not return valid output')
    })

    it('falls back to stderr when JSON parsing fails', () => {
      const stdout = '{invalid json}'
      const stderr = 'Error: migration failed\n  at line 42'
      const result = parseMigrationOutput(stdout, stderr)
      expect(result.success).toBe(false)
      expect(result.error).toBe(stderr)
    })

    it('falls back to stdout when JSON parsing fails and stderr is empty', () => {
      const stdout = '{also invalid}'
      const result = parseMigrationOutput(stdout, '')
      expect(result.success).toBe(false)
      expect(result.error).toBe(stdout)
    })
  })

  describe('listSchemaFiles', () => {
    let schemaDir: string

    beforeEach(() => {
      schemaDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aiex-list-schema-'))
    })

    afterEach(() => {
      fs.rmSync(schemaDir, { recursive: true, force: true })
    })

    it('should return sorted JSON files from schema directory', async () => {
      fs.writeFileSync(path.join(schemaDir, 'z.json'), '{}')
      fs.writeFileSync(path.join(schemaDir, 'a.json'), '{}')
      fs.writeFileSync(path.join(schemaDir, 'm.json'), '{}')

      const files = await listSchemaFiles(schemaDir)
      expect(files).toHaveLength(3)
      expect(files[0]).toContain('a.json')
      expect(files[1]).toContain('m.json')
      expect(files[2]).toContain('z.json')
    })

    it('should filter out non-JSON files', async () => {
      fs.writeFileSync(path.join(schemaDir, 'test.json'), '{}')
      fs.writeFileSync(path.join(schemaDir, 'test.txt'), 'text')
      fs.writeFileSync(path.join(schemaDir, 'test.yaml'), 'yaml')

      const files = await listSchemaFiles(schemaDir)
      expect(files).toHaveLength(1)
      expect(files[0]).toContain('test.json')
    })

    it('should return empty array when directory does not exist', async () => {
      const files = await listSchemaFiles('/nonexistent/schema/dir')
      expect(files).toEqual([])
    })
  })

  describe('generateSchemaFromFiles', () => {
    let projectDir: string

    beforeEach(() => {
      projectDir = createProjectFixture()
    })

    afterEach(() => {
      process.chdir(originalCwd)
      cleanupAllTestDirs()
    })

    it('should generate schema from valid JSON files', async () => {
      const config = createMigrationConfig(projectDir)
      const schemaFiles = [
        path.join(projectDir, '.aiex', 'schema', 'test.json'),
      ]
      fs.writeFileSync(schemaFiles[0], JSON.stringify({
        title: 'Test',
        type: 'object',
        table: { name: 'test_table' },
        properties: { id: { type: 'integer', primary: true }, name: { type: 'string' } },
      }))

      const result = await generateSchemaFromFiles(schemaFiles, config)
      expect(result.success).toBe(true)
      expect(result.schemaCount).toBe(1)
      expect(result.tables).toBeGreaterThan(0)
    })

    it('should return error for invalid JSON content', async () => {
      const config = createMigrationConfig(projectDir)
      const schemaFiles = [
        path.join(projectDir, '.aiex', 'schema', 'bad.json'),
      ]
      fs.writeFileSync(schemaFiles[0], 'not valid json')

      const result = await generateSchemaFromFiles(schemaFiles, config)
      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
    })
  })

  describe('runSchemaSync', () => {
    let projectDir: string

    beforeEach(() => {
      projectDir = createProjectFixture()
    })

    afterEach(() => {
      process.chdir(originalCwd)
      cleanupAllTestDirs()
    })

    it('should fail when no schema files exist', async () => {
      const config = createMigrationConfig(projectDir)
      const result = await runSchemaSync(config)
      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
      expect(result.schemaCount).toBe(0)
    })

    it('should migrate generated schema into real SQLite tables with constraints and relations', async () => {
      const config = createMigrationConfig(projectDir)
      writeSchema(projectDir, 'invoice.json', createInvoiceSchema())

      const result = await runSchemaSync(config, { migrationName: 'Invoice Smoke' })

      expect(result.success).toBe(true)
      expect(result.migration?.success).toBe(true)
      expect(result.tables).toBe(2)
      expect(result.mappingEntries).toBeGreaterThanOrEqual(14)

      const db = new Database(config.databasePath, { readonly: true })
      try {
        const tables = db.prepare(`
          select name
          from sqlite_master
          where type = 'table' and name not like 'sqlite_%'
          order by name
        `).all() as Array<{ name: string }>
        expect(tables.map(t => t.name)).toEqual(['invoices', 'invoices_lines'])

        const invoiceColumns = db.prepare('pragma table_info(invoices)').all() as Array<{ name: string, type: string, notnull: number, pk: number }>
        expect(invoiceColumns).toContainEqual(expect.objectContaining({ name: 'invoice_no', type: 'TEXT', notnull: 1 }))
        expect(invoiceColumns).toContainEqual(expect.objectContaining({ name: 'total_amount', type: 'REAL', notnull: 1 }))
        expect(invoiceColumns).toContainEqual(expect.objectContaining({ name: 'created_at', type: 'INTEGER', notnull: 1 }))
        expect(invoiceColumns).toContainEqual(expect.objectContaining({ name: 'updated_at', type: 'INTEGER', notnull: 1 }))
        expect(invoiceColumns).toContainEqual(expect.objectContaining({ name: 'deleted_at', type: 'INTEGER', notnull: 0 }))

        const lineColumns = db.prepare('pragma table_info(invoices_lines)').all() as Array<{ name: string, type: string, notnull: number }>
        expect(lineColumns).toContainEqual(expect.objectContaining({ name: 'invoices_id', type: 'INTEGER', notnull: 1 }))
        expect(lineColumns).toContainEqual(expect.objectContaining({ name: 'quantity', type: 'INTEGER', notnull: 1 }))

        const indexes = db.prepare(`
          select name
          from sqlite_master
          where type = 'index' and tbl_name = 'invoices'
        `).all() as Array<{ name: string }>
        expect(indexes.map(i => i.name)).toContain('invoices_invoice_no_unique')

        const createSql = db.prepare(`
          select sql
          from sqlite_master
          where type = 'table' and name = 'invoices'
        `).get() as { sql: string }
        expect(createSql.sql).toContain('CONSTRAINT "invoice_no_min_length"')
        expect(createSql.sql).toContain('CONSTRAINT "invoice_no_max_length"')
        expect(createSql.sql).toContain('CONSTRAINT "total_amount_min"')
      }
      finally {
        db.close()
      }
    }, 20000)

    it('should insert extracted data into a real migrated SQLite database', async () => {
      const config = createMigrationConfig(projectDir)
      const schema = createInvoiceSchema()
      writeSchema(projectDir, 'invoice.json', schema)

      const sync = await runSchemaSync(config, { migrationName: 'Invoice Insert Smoke' })
      expect(sync.success).toBe(true)

      const db = new Database(config.databasePath)
      try {
        const inserted = insertExtractedData(db, schema, {
          invoiceNo: 'INV-001',
          totalAmount: 42.5,
          paid: true,
          issuedAt: '2026-06-11T00:00:00.000Z',
          metadata: { source: 'fixture' },
          lines: [
            { description: 'Service fee', quantity: 2, unitPrice: 21.25 },
          ],
        })

        expect(inserted.success).toBe(true)
        expect(inserted.tablesInserted).toEqual([
          { table: 'invoices', rowId: 1 },
          { table: 'invoices_lines', rowId: 1 },
        ])

        const invoice = db.prepare('select * from invoices').get() as Record<string, unknown>
        expect(invoice.invoice_no).toBe('INV-001')
        expect(invoice.total_amount).toBe(42.5)
        expect(invoice.paid).toBe(1)
        expect(invoice.issued_at).toBe(1781136000)
        expect(invoice.metadata).toBe(JSON.stringify({ source: 'fixture' }))
        expect(invoice.created_at).toEqual(expect.any(Number))
        expect(invoice.updated_at).toEqual(expect.any(Number))
        expect(invoice.deleted_at).toBeNull()

        const line = db.prepare('select * from invoices_lines').get() as Record<string, unknown>
        expect(line.invoices_id).toBe(1)
        expect(line.description).toBe('Service fee')
        expect(line.quantity).toBe(2)
        expect(line.unit_price).toBe(21.25)
      }
      finally {
        db.close()
      }
    }, 20000)

    it('should migrate a representative Web schema editor output', async () => {
      const config = createMigrationConfig(projectDir)
      writeSchema(projectDir, 'customers.json', createWebEditorEcommerceSchema())

      const result = await runSchemaSync(config, { migrationName: 'Web Schema Fixture' })

      expect(result.success).toBe(true)
      expect(result.tables).toBe(3)

      const db = new Database(config.databasePath, { readonly: true })
      try {
        const tables = db.prepare(`
          select name
          from sqlite_master
          where type = 'table' and name not like 'sqlite_%'
          order by name
        `).all() as Array<{ name: string }>
        expect(tables.map(t => t.name)).toEqual(['customers', 'customers_address', 'customers_orders'])

        const customerColumns = db.prepare('pragma table_info(customers)').all() as Array<{ name: string, type: string, notnull: number }>
        expect(customerColumns).toContainEqual(expect.objectContaining({ name: 'email', type: 'TEXT', notnull: 1 }))
        expect(customerColumns).toContainEqual(expect.objectContaining({ name: 'credit_balance', type: 'REAL' }))
        expect(customerColumns).toContainEqual(expect.objectContaining({ name: 'is_active', type: 'INTEGER' }))
        expect(customerColumns).toContainEqual(expect.objectContaining({ name: 'last_login_at', type: 'INTEGER' }))
        expect(customerColumns).toContainEqual(expect.objectContaining({ name: 'metadata', type: 'TEXT' }))
        expect(customerColumns).toContainEqual(expect.objectContaining({ name: 'created_at', type: 'INTEGER', notnull: 1 }))
        expect(customerColumns).toContainEqual(expect.objectContaining({ name: 'deleted_at', type: 'INTEGER', notnull: 0 }))

        const orderColumns = db.prepare('pragma table_info(customers_orders)').all() as Array<{ name: string, type: string, notnull: number }>
        expect(orderColumns).toContainEqual(expect.objectContaining({ name: 'customers_id', type: 'INTEGER', notnull: 1 }))
        expect(orderColumns).toContainEqual(expect.objectContaining({ name: 'order_number', type: 'TEXT' }))
        expect(orderColumns).toContainEqual(expect.objectContaining({ name: 'paid_at', type: 'INTEGER' }))

        const addressColumns = db.prepare('pragma table_info(customers_address)').all() as Array<{ name: string, type: string, notnull: number }>
        expect(addressColumns).toContainEqual(expect.objectContaining({ name: 'customers_id', type: 'INTEGER', notnull: 1 }))
        expect(addressColumns).toContainEqual(expect.objectContaining({ name: 'zip_code', type: 'TEXT' }))
        expect(addressColumns).toContainEqual(expect.objectContaining({ name: 'is_default', type: 'INTEGER' }))
      }
      finally {
        db.close()
      }
    }, 20000)

    it('should block high-risk migrations before applying migration', async () => {
      const config = createMigrationConfig(projectDir)
      fs.mkdirSync(path.dirname(config.drizzleSchemaPath), { recursive: true })
      fs.writeFileSync(path.join(path.dirname(config.drizzleSchemaPath), 'schema-map.json'), JSON.stringify({
        dialect: 'aiex-drizzle',
        databaseDialect: 'sqlite',
        entries: [
          {
            schemaPath: `${projectDir}/.aiex/schema/customer.json.properties.name`,
            table: 'customers',
            column: 'name',
            drizzleType: 'text()',
            databaseType: 'text',
            nullable: true,
            primary: false,
            unique: false,
            relation: 'root',
            notes: [],
          },
          {
            schemaPath: `${projectDir}/.aiex/schema/customer.json.properties.email`,
            table: 'customers',
            column: 'email',
            drizzleType: 'text()',
            databaseType: 'text',
            nullable: true,
            primary: false,
            unique: false,
            relation: 'root',
            notes: [],
          },
        ],
      }))
      fs.writeFileSync(path.join(config.schemaPath, 'customer.json'), JSON.stringify({
        title: 'Customer',
        type: 'object',
        table: { name: 'customers' },
        properties: {
          name: { type: 'string' },
        },
      }))

      const result = await runSchemaSync(config)

      expect(result.success).toBe(false)
      expect(result.error).toBe('High-risk schema migration blocked')
      expect(result.riskReport.hasHighRisk).toBe(true)
      expect(result.riskReport.items).toContainEqual(expect.objectContaining({
        kind: 'column_removed',
        column: 'email',
      }))

      const report = JSON.parse(fs.readFileSync(path.join(path.dirname(config.drizzleSchemaPath), 'schema-map.json'), 'utf-8')) as {
        baselineEntries?: unknown[]
      }
      expect(report.baselineEntries).toHaveLength(2)
    })

    it('should block tightened CHECK constraints based on the previous schema map', async () => {
      const config = createMigrationConfig(projectDir)
      writeSchema(projectDir, 'customer.json', {
        title: 'Customer',
        type: 'object',
        table: { name: 'customers' },
        properties: {
          name: { type: 'string', minLength: 2 },
        },
      })

      const baseline = await runSchemaSync(config, { generateOnly: true })
      expect(baseline.success).toBe(true)

      writeSchema(projectDir, 'customer.json', {
        title: 'Customer',
        type: 'object',
        table: { name: 'customers' },
        properties: {
          name: { type: 'string', minLength: 3 },
        },
      })

      const result = await runSchemaSync(config)

      expect(result.success).toBe(false)
      expect(result.error).toBe('High-risk schema migration blocked')
      expect(result.riskReport.items).toContainEqual(expect.objectContaining({
        kind: 'constraint_tightened',
        column: 'name',
        severity: 'high',
      }))
    })

    it('should allow high-risk migrations when force is enabled', async () => {
      const config = createMigrationConfig(projectDir)
      fs.mkdirSync(path.dirname(config.drizzleSchemaPath), { recursive: true })
      fs.writeFileSync(path.join(path.dirname(config.drizzleSchemaPath), 'schema-map.json'), JSON.stringify({
        dialect: 'aiex-drizzle',
        databaseDialect: 'sqlite',
        entries: [
          {
            schemaPath: `${projectDir}/.aiex/schema/customer.json.properties.email`,
            table: 'customers',
            column: 'email',
            drizzleType: 'text()',
            databaseType: 'text',
            nullable: true,
            primary: false,
            unique: false,
            relation: 'root',
            notes: [],
          },
        ],
      }))
      fs.writeFileSync(path.join(config.schemaPath, 'customer.json'), JSON.stringify({
        title: 'Customer',
        type: 'object',
        table: { name: 'customers' },
        properties: {
          name: { type: 'string' },
        },
      }))

      const result = await runSchemaSync(config, { force: true })

      expect(result.error).not.toBe('High-risk schema migration blocked')
      expect(result.riskReport.hasHighRisk).toBe(true)

      const report = JSON.parse(fs.readFileSync(path.join(path.dirname(config.drizzleSchemaPath), 'schema-map.json'), 'utf-8')) as {
        baselineEntries?: unknown[]
      }
      expect(report.baselineEntries).toBeUndefined()
    }, 20000)
  })
})
