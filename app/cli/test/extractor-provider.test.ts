import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_EXTRACTION_CONFIG, DEFAULT_PROMPT_CONFIG } from '@/core/ai-extraction/types'
import { personSchema } from './ai-extraction.test-utils'

const createOpenAICompatibleMock = vi.hoisted(() => vi.fn())
const generateTextMock = vi.hoisted(() => vi.fn())

vi.mock('@ai-sdk/openai-compatible', () => ({
  createOpenAICompatible: createOpenAICompatibleMock,
}))

vi.mock('ai', () => ({
  generateText: generateTextMock,
  jsonSchema: vi.fn(schema => schema),
  Output: {
    object: vi.fn(options => ({ type: 'object', ...options })),
  },
}))

describe('extractStructuredData provider setup', () => {
  let tempDir = ''

  afterEach(async () => {
    vi.clearAllMocks()
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true })
      tempDir = ''
    }
  })

  it('enables OpenAI-compatible structured outputs when the selected model supports them', async () => {
    const { extractStructuredData } = await import('@/core/ai-extraction/extractor')
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aiex-provider-test-'))

    createOpenAICompatibleMock.mockReturnValue({
      chatModel: vi.fn((modelName: string) => ({ modelName })),
    })
    generateTextMock.mockResolvedValue({
      output: { name: 'Alice', age: 28, city: 'Shanghai' },
      usage: { inputTokens: 1, outputTokens: 1 },
    })

    const result = await extractStructuredData({
      config: {
        provider: {
          baseURL: 'https://example.test/v1',
          apiKey: 'test-key',
          models: [
            { name: 'gemini-2.5-flash', capabilities: { structuredOutput: true } },
          ],
        },
        prompt: DEFAULT_PROMPT_CONFIG,
        extraction: DEFAULT_EXTRACTION_CONFIG,
      },
      schema: personSchema,
      text: 'Alice is 28 years old and lives in Shanghai',
      aiexDir: tempDir,
    })

    expect(result.success).toBe(true)
    expect(createOpenAICompatibleMock).toHaveBeenCalledWith(expect.objectContaining({
      baseURL: 'https://example.test/v1',
      name: 'openai-compatible',
      apiKey: 'test-key',
      supportsStructuredOutputs: true,
    }))
  })

  it('does not enable OpenAI-compatible structured outputs for text-only models', async () => {
    const { extractStructuredData } = await import('@/core/ai-extraction/extractor')
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aiex-provider-test-'))

    createOpenAICompatibleMock.mockReturnValue({
      chatModel: vi.fn((modelName: string) => ({ modelName })),
    })
    generateTextMock.mockResolvedValue({
      text: '{"name":"Alice","age":28,"city":"Shanghai"}',
      usage: { inputTokens: 1, outputTokens: 1 },
    })

    const result = await extractStructuredData({
      config: {
        provider: {
          baseURL: 'https://example.test/v1',
          apiKey: 'test-key',
          models: [
            { name: 'text-model', capabilities: { structuredOutput: false } },
          ],
        },
        prompt: DEFAULT_PROMPT_CONFIG,
        extraction: DEFAULT_EXTRACTION_CONFIG,
      },
      schema: personSchema,
      text: 'Alice is 28 years old and lives in Shanghai',
      aiexDir: tempDir,
    })

    expect(result.success).toBe(true)
    expect(createOpenAICompatibleMock).toHaveBeenCalledWith(expect.objectContaining({
      supportsStructuredOutputs: false,
    }))
  })
})
