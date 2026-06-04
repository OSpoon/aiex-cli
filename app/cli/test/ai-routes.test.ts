import type { MigrationConfig } from '@/domain/schema/types'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { writeFile as writeJsonFile } from 'jsonfile'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { aiRoutes } from '@/server/routes/ai'

describe('ai routes', () => {
  let tempDir: string
  let config: MigrationConfig

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aiex-ai-routes-'))
    const schemaPath = path.join(tempDir, 'schema')
    await fs.mkdir(schemaPath, { recursive: true })

    config = {
      databaseDialect: 'sqlite',
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

  describe('ai config read', () => {
    it('returns defaults when no config exists', async () => {
      const app = aiRoutes(config)
      const response = await app.request('/ai/config')
      expect(response.status).toBe(200)
      const body = await response.json() as any
      expect(body.provider.baseURL).toBe('https://dashscope.aliyuncs.com/compatible-mode/v1')
      expect(body.provider.apiKey).toBe('')
      expect(body.extraction.outputDir).toBe('.aiex/extracted')
    })

    it('returns existing config', async () => {
      await writeJsonFile(path.join(tempDir, 'ai-config.json'), {
        provider: {
          baseURL: 'http://localhost:11434/v1',
          apiKey: 'test-key',
          models: [{ name: 'llama3.2', capabilities: { vision: false, structuredOutput: false } }],
        },
        prompt: {
          systemTemplate: 'Schema: {schema}',
          userTemplate: 'Text: {text}',
        },
        extraction: { outputDir: '.aiex/extracted' },
      }, { spaces: 2 })

      const app = aiRoutes(config)
      const response = await app.request('/ai/config')
      const body = await response.json() as any
      expect(body.provider.baseURL).toBe('http://localhost:11434/v1')
      expect(body.provider.models).toHaveLength(1)
    })
  })

  describe('registry lookup', () => {
    it('returns capabilities for known model', async () => {
      const app = aiRoutes(config)
      const response = await app.request('/ai/registry-lookup', {
        method: 'POST',
        body: JSON.stringify({ modelName: 'gpt-4o' }),
        headers: { 'content-type': 'application/json' },
      })
      expect(response.status).toBe(200)
      const body = await response.json() as any
      expect(body.vision).toBe(true)
      expect(body.structuredOutput).toBe(true)
    })

    it('returns empty for unknown model', async () => {
      const app = aiRoutes(config)
      const response = await app.request('/ai/registry-lookup', {
        method: 'POST',
        body: JSON.stringify({ modelName: 'nonexistent' }),
        headers: { 'content-type': 'application/json' },
      })
      const body = await response.json() as any
      expect(Object.keys(body)).toHaveLength(0)
    })
  })

  describe('ai config write', () => {
    it('persists config', async () => {
      const app = aiRoutes(config)
      const response = await app.request('/ai/config', {
        method: 'PUT',
        body: JSON.stringify({
          provider: {
            baseURL: 'http://localhost:11434/v1',
            apiKey: 'new-key',
            models: [{ name: 'test-model', capabilities: { vision: false, structuredOutput: false } }],
          },
          prompt: {
            systemTemplate: '{schema}',
            userTemplate: '{text}',
          },
          extraction: { outputDir: '.aiex/extracted' },
        }),
        headers: { 'content-type': 'application/json' },
      })
      expect(response.status).toBe(200)

      const read = await app.request('/ai/config')
      const body = await read.json() as any
      expect(body.provider.apiKey).toBe('new-key')
    })

    it('rejects config without {schema} in system prompt', async () => {
      const app = aiRoutes(config)
      const response = await app.request('/ai/config', {
        method: 'PUT',
        body: JSON.stringify({
          provider: {
            baseURL: 'http://localhost:11434/v1',
            apiKey: 'key',
            models: [{ name: 'test', capabilities: { vision: false, structuredOutput: false } }],
          },
          prompt: {
            systemTemplate: 'no placeholder',
            userTemplate: '{text}',
          },
          extraction: { outputDir: '.aiex/extracted' },
        }),
        headers: { 'content-type': 'application/json' },
      })
      expect(response.status).toBe(400)
    })

    it('rejects config without {text} in user prompt', async () => {
      const app = aiRoutes(config)
      const response = await app.request('/ai/config', {
        method: 'PUT',
        body: JSON.stringify({
          provider: {
            baseURL: 'http://localhost:11434/v1',
            apiKey: 'key',
            models: [{ name: 'test', capabilities: { vision: false, structuredOutput: false } }],
          },
          prompt: {
            systemTemplate: '{schema}',
            userTemplate: 'no placeholder',
          },
          extraction: { outputDir: '.aiex/extracted' },
        }),
        headers: { 'content-type': 'application/json' },
      })
      expect(response.status).toBe(400)
    })

    it('rejects config with no models', async () => {
      const app = aiRoutes(config)
      const response = await app.request('/ai/config', {
        method: 'PUT',
        body: JSON.stringify({
          provider: {
            baseURL: 'http://localhost:11434/v1',
            apiKey: 'key',
            models: [],
          },
          prompt: {
            systemTemplate: '{schema}',
            userTemplate: '{text}',
          },
          extraction: { outputDir: '.aiex/extracted' },
        }),
        headers: { 'content-type': 'application/json' },
      })
      expect(response.status).toBe(400)
    })
  })
})
