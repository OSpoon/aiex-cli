import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { writeFile as writeJsonFile } from 'jsonfile'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getDefaultAIConfig, readAIConfig, writeAIConfig } from '@/core/ai-extraction/config'
import { DEFAULT_AI_CONFIG } from '@/core/ai-extraction/types'

describe('ai config', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aiex-ai-config-'))
  })

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true })
  })

  describe('getDefaultAIConfig', () => {
    it('returns deep clone of default config', () => {
      const config = getDefaultAIConfig()
      expect(config).toEqual(DEFAULT_AI_CONFIG)
      expect(config.provider).not.toBe(DEFAULT_AI_CONFIG.provider)
    })
  })

  describe('readAIConfig', () => {
    it('returns null when config file does not exist', async () => {
      const config = await readAIConfig(tempDir)
      expect(config).toBeNull()
    })

    it('reads and validates valid config', async () => {
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
        extraction: {
          outputDir: '.aiex/extracted',
        },
      }, { spaces: 2 })

      const config = await readAIConfig(tempDir)
      expect(config).not.toBeNull()
      expect(config!.provider.baseURL).toBe('http://localhost:11434/v1')
      expect(config!.provider.models).toHaveLength(1)
      expect(config!.provider.models[0].name).toBe('llama3.2')
    })

    it('returns null for invalid config', async () => {
      await writeJsonFile(path.join(tempDir, 'ai-config.json'), {
        provider: {
          baseURL: 'http://localhost:11434/v1',
          apiKey: 'test-key',
          models: 'not-an-array',
        },
      }, { spaces: 2 })

      const config = await readAIConfig(tempDir)
      expect(config).toBeNull()
    })
  })

  describe('writeAIConfig', () => {
    it('writes config to disk', async () => {
      const config = getDefaultAIConfig()
      config.provider.baseURL = 'http://localhost:11434/v1'
      config.provider.models = [{ name: 'test-model', capabilities: { vision: false, structuredOutput: false } }]

      await writeAIConfig(tempDir, config)

      const read = await readAIConfig(tempDir)
      expect(read).not.toBeNull()
      expect(read!.provider.baseURL).toBe('http://localhost:11434/v1')
    })
  })
})
