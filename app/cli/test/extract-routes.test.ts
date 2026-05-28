import type { MigrationConfig } from '@/domain/schema/types'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { writeFile as writeJsonFile } from 'jsonfile'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_EXTRACTION_CONFIG, DEFAULT_PROMPT_CONFIG } from '@/domain/ai/types'
import { extractRoutes } from '@/server/routes/extract'

interface ErrorResponse {
  success: boolean
  error: string
  auditId?: string
}

interface AuditRecordResponse {
  id: string
  status: string
  schemaName: string
  error?: string
  source: { type: string, text?: string, fileName?: string, filePath?: string }
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
    expect(body.auditId).toBeUndefined()

    const recordsResponse = await app.request('/extract/records')
    const records = await recordsResponse.json() as AuditRecordResponse[]
    expect(records).toHaveLength(0)
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
    expect(body.auditId).toBeUndefined()
  })

  it('normalizes upload extension from MIME type before later parsing', async () => {
    const app = extractRoutes(config)
    const form = new FormData()
    form.set('schema', 'person')
    form.set('file', new File(['Alice is 30'], 'photo.jpg', { type: 'text/plain' }))

    const response = await app.request('/extract', {
      method: 'POST',
      body: form,
    })
    const body = await response.json() as ErrorResponse

    expect(response.status).toBe(400)
    expect(body.auditId).toBeUndefined()
  })

  it('rejects unsupported upload content', async () => {
    const app = extractRoutes(config)
    const form = new FormData()
    form.set('schema', 'person')
    form.set('file', new File([new Uint8Array([0xFF, 0x00, 0x01])], 'source.bin', { type: 'application/octet-stream' }))

    const response = await app.request('/extract', {
      method: 'POST',
      body: form,
    })
    const body = await response.json() as ErrorResponse

    expect(response.status).toBe(400)
    expect(body.success).toBe(false)
    expect(body.error).toBe('Unsupported file type "application/octet-stream". Supported: images, PDF, text, markdown, CSV, JSON, HTML, XML, YAML.')
    expect(body.auditId).toBeUndefined()
  })

  it('returns 404 when retrying a missing extraction record', async () => {
    const app = extractRoutes(config)

    const response = await app.request('/extract/records/missing/retry', {
      method: 'POST',
    })
    const body = await response.json() as ErrorResponse

    expect(response.status).toBe(404)
    expect(body.success).toBe(false)
    expect(body.error).toBe('Extraction record not found')
  })

  it('reports a clear error when retrying an extraction whose uploaded file is gone', async () => {
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

    const auditDir = path.join(tempDir, 'extracted', '_audit')
    const missingUploadPath = path.join(tempDir, 'uploads', 'missing-source.txt')
    await fs.mkdir(auditDir, { recursive: true })
    await writeJsonFile(path.join(auditDir, 'run-1.json'), {
      id: 'run-1',
      status: 'failed',
      schemaName: 'person',
      source: { type: 'file', filePath: missingUploadPath, fileName: 'source.txt' },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })

    const app = extractRoutes(config)
    const response = await app.request('/extract/records/run-1/retry', {
      method: 'POST',
    })
    const body = await response.json() as ErrorResponse

    expect(response.status).toBe(500)
    expect(body.success).toBe(false)
    expect(body.error).toContain('ENOENT')
  })

  it('marks interrupted running records as stale when listing records', async () => {
    const auditDir = path.join(tempDir, 'extracted', '_audit')
    await fs.mkdir(auditDir, { recursive: true })
    await writeJsonFile(path.join(auditDir, 'old-run.json'), {
      id: 'old-run',
      status: 'running',
      schemaName: 'person',
      source: { type: 'text', text: 'Alice is 30' },
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    })

    const app = extractRoutes(config)
    const response = await app.request('/extract/records')
    const records = await response.json() as AuditRecordResponse[]

    expect(response.status).toBe(200)
    expect(records[0]).toMatchObject({
      id: 'old-run',
      status: 'stale',
      error: 'Extraction did not finish. It may have been interrupted.',
    })
  })

  it('deletes audit records and their cached upload files', async () => {
    const auditDir = path.join(tempDir, 'extracted', '_audit')
    const uploadsDir = path.join(tempDir, 'uploads')
    const uploadPath = path.join(uploadsDir, 'run-1-source.txt')
    await fs.mkdir(auditDir, { recursive: true })
    await fs.mkdir(uploadsDir, { recursive: true })
    await fs.writeFile(uploadPath, 'Alice is 30')
    await writeJsonFile(path.join(auditDir, 'run-1.json'), {
      id: 'run-1',
      status: 'failed',
      schemaName: 'person',
      source: { type: 'file', filePath: uploadPath, fileName: 'source.txt' },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })

    const app = extractRoutes(config)
    const response = await app.request('/extract/records/run-1', {
      method: 'DELETE',
    })
    const body = await response.json() as { success: boolean }

    expect(response.status).toBe(200)
    expect(body.success).toBe(true)
    await expect(fs.stat(path.join(auditDir, 'run-1.json'))).rejects.toThrow()
    await expect(fs.stat(uploadPath)).rejects.toThrow()
  })
})
