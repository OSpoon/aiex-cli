import type { MigrationConfig } from '@/core/schema-sqlite/types'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { writeFile as writeJsonFile } from 'jsonfile'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { dataRoutes } from '@/server/routes/data'

const writeNotionPageMock = vi.hoisted(() => vi.fn())

vi.mock('@/core/notion-sink', () => ({
  writeNotionPage: writeNotionPageMock,
}))

interface DataTableResponse {
  columns: Array<{ name: string, type: string, notNull: boolean, pk: boolean }>
  rows: Array<Record<string, unknown>>
  total: number
  totalPages: number
}

interface ErrorResponse {
  error: string
}

describe('data routes', () => {
  let tempDir: string
  let config: MigrationConfig

  beforeEach(async () => {
    writeNotionPageMock.mockReset()
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aiex-data-routes-'))
    const schemaPath = path.join(tempDir, 'schema')
    await fs.mkdir(schemaPath, { recursive: true })

    config = {
      schemaPath,
      databasePath: path.join(tempDir, 'database.db'),
      drizzleSchemaPath: path.join(tempDir, 'schema.ts'),
      migrationsPath: path.join(tempDir, 'migrations'),
      drizzleConfigPath: path.join(tempDir, 'drizzle.config.ts'),
    }

    const db = new Database(config.databasePath)
    db.exec(`
      create table people (
        id integer primary key,
        name text not null,
        email text
      )
    `)
    const insert = db.prepare('insert into people (id, name, email) values (?, ?, ?)')
    insert.run(1, 'Alice', 'alice@example.com')
    insert.run(2, 'Bob', 'bob@example.com')
    insert.run(3, 'Alicia', 'alicia@example.com')
    db.close()
  })

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true })
  })

  it('queries table data with search, sort, and pagination', async () => {
    const app = dataRoutes(config)

    const response = await app.request('/data/tables/people?search=ali&sortField=name&sortOrder=desc&page=1&pageSize=1')
    const body = await response.json() as DataTableResponse

    expect(response.status).toBe(200)
    expect(body.columns).toEqual([
      { name: 'id', type: 'INTEGER', notNull: false, pk: true },
      { name: 'name', type: 'TEXT', notNull: true, pk: false },
      { name: 'email', type: 'TEXT', notNull: false, pk: false },
    ])
    expect(body.total).toBe(2)
    expect(body.totalPages).toBe(2)
    expect(body.rows).toEqual([
      { id: 3, name: 'Alicia', email: 'alicia@example.com' },
    ])
  })

  it('includes extraction JSON actions for rows inserted from an audited extraction', async () => {
    const auditDir = path.join(tempDir, 'extracted', '_audit')
    await fs.mkdir(auditDir, { recursive: true })
    await writeJsonFile(path.join(auditDir, 'run-1.json'), {
      id: 'run-1',
      status: 'succeeded',
      schemaName: 'people',
      source: { type: 'text', text: 'Alice' },
      outputName: 'people-2026-05-21T09-00-00-000Z.json',
      tablesInserted: [{ table: 'people', rowId: 1 }],
      notionPages: [{ databaseId: 'database-1', pageId: 'page-1' }],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })

    const app = dataRoutes(config)
    const response = await app.request('/data/tables/people?sortField=id&sortOrder=asc&page=1&pageSize=1')
    const body = await response.json() as DataTableResponse & {
      rowActions?: Record<string, { extractionName: string, notionStatus: string }>
    }

    expect(response.status).toBe(200)
    expect(body.rows).toEqual([
      { id: 1, name: 'Alice', email: 'alice@example.com' },
    ])
    expect(body.rowActions?.['0']).toMatchObject({
      extractionName: 'people-2026-05-21T09-00-00-000Z.json',
      notionStatus: 'synced',
    })
  })

  it('rejects invalid table names before query construction', async () => {
    const app = dataRoutes(config)

    const response = await app.request('/data/tables/people%3Bdrop')
    const body = await response.json() as ErrorResponse

    expect(response.status).toBe(400)
    expect(body.error).toBe('Invalid table name')
  })

  it('retries Notion sync for a saved extraction without rerunning extraction', async () => {
    await writeJsonFile(path.join(tempDir, 'ai-config.json'), {
      provider: {
        baseURL: 'https://example.test/v1',
        apiKey: 'test-key',
        models: [{ name: 'test-model', capabilities: { vision: false, structuredOutput: true } }],
      },
      prompt: { systemTemplate: '{schema}', userTemplate: '{text}' },
      extraction: { outputDir: '.aiex/extracted' },
      notion: {
        enabled: true,
        token: 'notion-token',
        schemas: {
          person: {
            databaseId: 'source-1',
          },
        },
      },
    })
    const extractedDir = path.join(tempDir, 'extracted')
    await fs.mkdir(extractedDir, { recursive: true })
    await writeJsonFile(path.join(extractedDir, 'person-2026-05-21T09-00-00-000Z.json'), {
      name: 'Alice',
    })
    writeNotionPageMock.mockResolvedValueOnce({
      databaseId: 'database-1',
      dataSourceId: 'source-1',
      pageId: 'page-1',
    })

    const app = dataRoutes(config)
    const response = await app.request('/data/person-2026-05-21T09-00-00-000Z.json/notion/retry', {
      method: 'POST',
    })
    const body = await response.json() as { success: boolean, notionPages?: Array<{ databaseId: string, pageId: string }> }

    expect(response.status).toBe(200)
    expect(body).toEqual({
      success: true,
      notionPages: [{ databaseId: 'database-1', pageId: 'page-1' }],
    })
    expect(writeNotionPageMock).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: true, token: 'notion-token' }),
      'person',
      { name: 'Alice' },
    )

    const listResponse = await app.request('/data')
    const records = await listResponse.json() as Array<{ name: string, notionStatus: string, notionPages?: unknown[] }>
    expect(records.find(record => record.name === 'person-2026-05-21T09-00-00-000Z.json')).toMatchObject({
      notionStatus: 'synced',
      notionPages: [{ databaseId: 'database-1', pageId: 'page-1' }],
    })
  })

  it('marks Notion sync as failed when manual sync fails for an audited extraction', async () => {
    await writeJsonFile(path.join(tempDir, 'ai-config.json'), {
      provider: {
        baseURL: 'https://example.test/v1',
        apiKey: 'test-key',
        models: [{ name: 'test-model', capabilities: { vision: false, structuredOutput: true } }],
      },
      prompt: { systemTemplate: '{schema}', userTemplate: '{text}' },
      extraction: { outputDir: '.aiex/extracted' },
      notion: {
        enabled: true,
        token: 'notion-token',
        schemas: {
          person: {
            databaseId: 'source-1',
          },
        },
      },
    })
    const extractedDir = path.join(tempDir, 'extracted')
    const auditDir = path.join(extractedDir, '_audit')
    await fs.mkdir(auditDir, { recursive: true })
    await writeJsonFile(path.join(extractedDir, 'person-2026-05-21T09-00-00-000Z.json'), {
      name: 'Alice',
    })
    await writeJsonFile(path.join(auditDir, 'run-1.json'), {
      id: 'run-1',
      status: 'succeeded',
      schemaName: 'person',
      source: { type: 'text', text: 'Alice' },
      outputName: 'person-2026-05-21T09-00-00-000Z.json',
      outputPath: path.join(extractedDir, 'person-2026-05-21T09-00-00-000Z.json'),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    writeNotionPageMock.mockRejectedValueOnce(new Error('Notion unavailable'))

    const app = dataRoutes(config)
    const response = await app.request('/data/person-2026-05-21T09-00-00-000Z.json/notion/retry', {
      method: 'POST',
    })

    expect(response.status).toBe(500)
    const listResponse = await app.request('/data')
    const records = await listResponse.json() as Array<{ name: string, notionStatus: string, notionError?: string }>
    expect(records.find(record => record.name === 'person-2026-05-21T09-00-00-000Z.json')).toMatchObject({
      notionStatus: 'failed',
      notionError: 'Notion unavailable',
    })
  })
})
