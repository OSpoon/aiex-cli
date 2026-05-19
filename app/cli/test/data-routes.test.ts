import type { MigrationConfig } from '@/core/schema-sqlite/types'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { dataRoutes } from '@/server/routes/data'

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

  it('rejects invalid table names before query construction', async () => {
    const app = dataRoutes(config)

    const response = await app.request('/data/tables/people%3Bdrop')
    const body = await response.json() as ErrorResponse

    expect(response.status).toBe(400)
    expect(body.error).toBe('Invalid table name')
  })
})
