import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { listExtractions, listTables, schemaNameFromExtractionFile } from '@/core/data-service'

vi.mock('@/infrastructure/audit/file-audit-store', () => ({
  listExtractionAuditRecords: vi.fn(),
}))

describe('data-service', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aiex-data-service-'))
  })

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
    vi.clearAllMocks()
  })

  describe('schemaNameFromExtractionFile', () => {
    it('should extract schema name from extraction file name', () => {
      expect(schemaNameFromExtractionFile('people-2026-05-21T09-00-00-000Z.json')).toBe('people')
    })

    it('should return null for file without timestamp', () => {
      expect(schemaNameFromExtractionFile('people.json')).toBeNull()
    })

    it('should return null for file with timestamp at start', () => {
      expect(schemaNameFromExtractionFile('2026-05-21T09-00-00-000Z.json')).toBeNull()
    })

    it('should handle schema names with hyphens', () => {
      expect(schemaNameFromExtractionFile('my-schema-2026-05-21T09-00-00-000Z.json')).toBe('my-schema')
    })
  })

  describe('listTables', () => {
    it('should return empty array when schema dir does not exist', async () => {
      const config: any = {
        schemaPath: path.join(tempDir, 'nonexistent'),
        databasePath: path.join(tempDir, 'database.db'),
      }
      const tables = await listTables(config)
      expect(tables).toEqual([])
    })

    it('should list tables from schema files and database', async () => {
      const schemaPath = path.join(tempDir, 'schema')
      fs.mkdirSync(schemaPath, { recursive: true })

      fs.writeFileSync(path.join(schemaPath, 'people.json'), JSON.stringify({
        title: 'People',
        type: 'object',
        table: { name: 'people' },
        properties: { id: { type: 'integer', primary: true }, name: { type: 'string' } },
      }))
      fs.writeFileSync(path.join(schemaPath, 'products.json'), JSON.stringify({
        title: 'Products',
        type: 'object',
        table: { name: 'products' },
        properties: { id: { type: 'integer', primary: true }, title: { type: 'string' } },
      }))

      const dbPath = path.join(tempDir, 'database.db')
      const db = new Database(dbPath)
      db.exec('create table people (id integer primary key, name text)')
      db.exec('create table products (id integer primary key, title text)')
      db.exec('insert into people values (1, \'Alice\')')
      db.close()

      const config: any = { schemaPath, databasePath: dbPath }
      const tables = await listTables(config)
      expect(tables).toHaveLength(2)
      expect(tables.find(t => t.name === 'people')).toBeDefined()
      expect(tables.find(t => t.name === 'products')).toBeDefined()
    })
  })

  describe('listExtractions', () => {
    it('should return empty array when extracted dir does not exist', async () => {
      const { listExtractionAuditRecords } = await import('@/infrastructure/audit/file-audit-store')
      vi.mocked(listExtractionAuditRecords).mockResolvedValue([])

      const config: any = {
        schemaPath: path.join(tempDir, 'schema'),
      }
      const extractions = await listExtractions(config)
      expect(extractions).toEqual([])
    })

    it('should list extraction records from files', async () => {
      const { listExtractionAuditRecords } = await import('@/infrastructure/audit/file-audit-store')
      vi.mocked(listExtractionAuditRecords).mockResolvedValue([])

      const schemaPath = path.join(tempDir, 'schema')
      fs.mkdirSync(schemaPath, { recursive: true })
      const extractedDir = path.join(tempDir, 'extracted')
      fs.mkdirSync(extractedDir, { recursive: true })

      fs.writeFileSync(path.join(extractedDir, 'people-2026-05-21T09-00-00-000Z.json'), JSON.stringify({ name: 'Alice' }))

      const config: any = { schemaPath }
      const extractions = await listExtractions(config)
      expect(extractions).toHaveLength(1)
      expect(extractions[0].schemaName).toBe('people')
      expect(extractions[0].name).toBe('people-2026-05-21T09-00-00-000Z.json')
    })
  })
})
