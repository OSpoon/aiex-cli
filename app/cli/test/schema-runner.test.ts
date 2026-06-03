import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  generateSchemaFromFiles,
  listSchemaFiles,
  parseMigrationOutput,
  runSchemaSync,
} from '@/application/schema/schema-sync'
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

    it('should block high-risk migrations before applying migration', async () => {
      const config = createMigrationConfig(projectDir)
      fs.mkdirSync(path.dirname(config.drizzleSchemaPath), { recursive: true })
      fs.writeFileSync(path.join(path.dirname(config.drizzleSchemaPath), 'schema-map.json'), JSON.stringify({
        dialect: 'aiex-drizzle-sqlite',
        entries: [
          {
            schemaPath: `${projectDir}/.aiex/schema/customer.json.properties.name`,
            table: 'customers',
            column: 'name',
            drizzleType: 'text()',
            sqliteType: 'text',
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
            sqliteType: 'text',
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

    it('should allow high-risk migrations when force is enabled', async () => {
      const config = createMigrationConfig(projectDir)
      fs.mkdirSync(path.dirname(config.drizzleSchemaPath), { recursive: true })
      fs.writeFileSync(path.join(path.dirname(config.drizzleSchemaPath), 'schema-map.json'), JSON.stringify({
        dialect: 'aiex-drizzle-sqlite',
        entries: [
          {
            schemaPath: `${projectDir}/.aiex/schema/customer.json.properties.email`,
            table: 'customers',
            column: 'email',
            drizzleType: 'text()',
            sqliteType: 'text',
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
    })
  })
})
