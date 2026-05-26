import type { MigrationConfig } from '@/types'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { writeFile as writeJsonFile } from 'jsonfile'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { schemaRoutes } from '@/server/routes/schema'

describe('schema routes', () => {
  let tempDir: string
  let config: MigrationConfig

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aiex-schema-routes-'))
    const schemaPath = path.join(tempDir, 'schema')
    await fs.mkdir(schemaPath, { recursive: true })

    config = {
      schemaPath,
      databasePath: path.join(tempDir, 'database.db'),
      drizzleSchemaPath: path.join(tempDir, 'schema.ts'),
      migrationsPath: path.join(tempDir, 'migrations'),
      drizzleConfigPath: path.join(tempDir, 'drizzle.config.ts'),
    }
  })

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true })
  })

  it('lists schemas (empty)', async () => {
    const app = schemaRoutes(config)
    const response = await app.request('/schema')
    const body = await response.json() as any
    expect(response.status).toBe(200)
    expect(Array.isArray(body)).toBe(true)
    expect(body).toHaveLength(0)
  })

  it('lists schemas after writing a schema file', async () => {
    await writeJsonFile(path.join(config.schemaPath, 'test.json'), {
      title: 'Test',
      type: 'object',
      properties: { name: { type: 'string' } },
      table: { name: 'test' },
    }, { spaces: 2 })

    const app = schemaRoutes(config)
    const response = await app.request('/schema')
    const body = await response.json() as any
    expect(body).toHaveLength(1)
    expect(body[0]).toBe('test.json')
  })

  it('returns 404 for unknown schema', async () => {
    const app = schemaRoutes(config)
    const response = await app.request('/schema/nonexistent.json')
    expect(response.status).toBe(404)
  })

  it('returns schema content for known schema', async () => {
    await writeJsonFile(path.join(config.schemaPath, 'test.json'), {
      title: 'Test',
      type: 'object',
      properties: { name: { type: 'string' } },
      table: { name: 'test' },
    }, { spaces: 2 })

    const app = schemaRoutes(config)
    const response = await app.request('/schema/test.json')
    expect(response.status).toBe(200)
    const body = await response.json() as any
    expect(body.title).toBe('Test')
  })

  it('rejects schema names with path traversal', async () => {
    const app = schemaRoutes(config)
    const response = await app.request('/schema/../test.json')
    expect([400, 404]).toContain(response.status)
  })

  it('writes a new schema', async () => {
    const schema = {
      title: 'NewSchema',
      type: 'object',
      properties: { name: { type: 'string' } },
      table: { name: 'new_schema' },
    }
    const app = schemaRoutes(config)
    const response = await app.request('/schema/newschema.json', {
      method: 'POST',
      body: JSON.stringify(schema),
      headers: { 'content-type': 'application/json' },
    })
    expect(response.status).toBe(200)

    const read = await app.request('/schema/newschema.json')
    const body = await read.json() as any
    expect(body.title).toBe('NewSchema')
  })

  it('saves invalid schema (schema saved, snapshot skipped)', async () => {
    const app = schemaRoutes(config)
    const response = await app.request('/schema/bad.json', {
      method: 'POST',
      body: JSON.stringify({ invalid: true }),
      headers: { 'content-type': 'application/json' },
    })
    expect(response.status).toBe(200)
  })

  it('deletes a schema file', async () => {
    await writeJsonFile(path.join(config.schemaPath, 'test.json'), {
      title: 'Test',
      type: 'object',
      properties: { name: { type: 'string' } },
      table: { name: 'test' },
    }, { spaces: 2 })

    const app = schemaRoutes(config)
    const response = await app.request('/schema/test.json', { method: 'DELETE' })
    expect(response.status).toBe(200)

    const list = await app.request('/schema')
    const body = await list.json() as any
    expect(body).toHaveLength(0)
  })
})
