import type { MigrationConfig } from '@/core/schema-sqlite/types'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { writeFile as writeJsonFile } from 'jsonfile'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_EXTRACTION_CONFIG, DEFAULT_PROMPT_CONFIG } from '@/core/ai-extraction/types'
import { extractRoutes } from '@/server/routes/extract'

interface ErrorResponse {
  success: boolean
  error: string
}

describe('extract routes', () => {
  let tempDir: string
  let config: MigrationConfig

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aiex-extract-routes-'))
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

  it('requires a schema name', async () => {
    const app = extractRoutes(config)
    const form = new FormData()
    form.set('text', 'Alice is 30')

    const response = await app.request('/extract', {
      method: 'POST',
      body: form,
    })
    const body = await response.json() as ErrorResponse

    expect(response.status).toBe(400)
    expect(body.success).toBe(false)
    expect(body.error).toBe('Schema is required')
  })

  it('requires text or file input', async () => {
    const app = extractRoutes(config)
    const form = new FormData()
    form.set('schema', 'person')

    const response = await app.request('/extract', {
      method: 'POST',
      body: form,
    })
    const body = await response.json() as ErrorResponse

    expect(response.status).toBe(400)
    expect(body.success).toBe(false)
    expect(body.error).toBe('Provide text or upload a file to extract')
  })

  it('reports missing AI configuration before extraction', async () => {
    const app = extractRoutes(config)
    const form = new FormData()
    form.set('schema', 'person')
    form.set('text', 'Alice is 30')

    const response = await app.request('/extract', {
      method: 'POST',
      body: form,
    })
    const body = await response.json() as ErrorResponse

    expect(response.status).toBe(400)
    expect(body.success).toBe(false)
    expect(body.error).toBe('AI configuration not found. Configure AI settings first.')
  })

  it('validates model overrides against configured models', async () => {
    await writeJsonFile(path.join(tempDir, 'ai-config.json'), {
      provider: {
        baseURL: 'http://localhost:11434/v1',
        apiKey: 'test-key',
        models: [
          { name: 'known-model', capabilities: { vision: false, structuredOutput: true } },
        ],
      },
      prompt: DEFAULT_PROMPT_CONFIG,
      extraction: DEFAULT_EXTRACTION_CONFIG,
    })

    const app = extractRoutes(config)
    const form = new FormData()
    form.set('schema', 'person')
    form.set('text', 'Alice is 30')
    form.set('model', 'missing-model')

    const response = await app.request('/extract', {
      method: 'POST',
      body: form,
    })
    const body = await response.json() as ErrorResponse

    expect(response.status).toBe(400)
    expect(body.success).toBe(false)
    expect(body.error).toBe('Model "missing-model" not found in AI settings')
  })
})
