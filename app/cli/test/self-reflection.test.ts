import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_EXTRACTION_CONFIG } from '@/core/ai-extraction/types'
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

describe('self-Reflection Loop in extractStructuredData', () => {
  let tempDir = ''

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aiex-reflection-test-'))
    createOpenAICompatibleMock.mockReturnValue({
      chatModel: vi.fn((modelName: string) => ({ modelName })),
    })
  })

  afterEach(async () => {
    vi.clearAllMocks()
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true })
      tempDir = ''
    }
  })

  it('triggers self-reflection loop and succeeds on second attempt when first returns invalid JSON', async () => {
    const { extractStructuredData } = await import('@/core/ai-extraction/extractor')

    // 1st attempt: returns invalid JSON syntax
    // 2nd attempt: returns valid JSON syntax and correct schema types
    generateTextMock
      .mockResolvedValueOnce({
        text: 'invalid json syntax {',
        usage: { inputTokens: 10, outputTokens: 5 },
      })
      .mockResolvedValueOnce({
        text: '{"name": "Alice", "age": 28, "city": null}',
        usage: { inputTokens: 15, outputTokens: 10 },
      })

    const config = {
      provider: {
        baseURL: 'http://mock-url',
        apiKey: 'mock-key',
        models: [
          { name: 'mock-model', capabilities: { structuredOutput: false } },
        ],
      },
      prompt: {
        systemTemplate: '{schema}',
        userTemplate: '{text}',
      },
      extraction: DEFAULT_EXTRACTION_CONFIG,
    }

    const result = await extractStructuredData({
      config,
      schema: personSchema,
      text: 'Alice is 28 years old.',
      aiexDir: tempDir,
    })

    expect(result.success).toBe(true)
    expect(result.data).toEqual({ name: 'Alice', age: 28, city: null })
    expect(result.tokensUsed).toEqual({
      prompt: 25,
      completion: 15,
      total: 40,
    })
    expect(generateTextMock).toHaveBeenCalledTimes(2)
  })

  it('triggers self-reflection loop and succeeds on second attempt when first fails Zod-like type validation', async () => {
    const { extractStructuredData } = await import('@/core/ai-extraction/extractor')

    // 1st attempt: returns age as string "twenty-eight" instead of integer
    // 2nd attempt: corrects age to number 28
    generateTextMock
      .mockResolvedValueOnce({
        text: '{"name": "Alice", "age": "twenty-eight", "city": null}',
        usage: { inputTokens: 10, outputTokens: 5 },
      })
      .mockResolvedValueOnce({
        text: '{"name": "Alice", "age": 28, "city": null}',
        usage: { inputTokens: 15, outputTokens: 10 },
      })

    const config = {
      provider: {
        baseURL: 'http://mock-url',
        apiKey: 'mock-key',
        models: [
          { name: 'mock-model', capabilities: { structuredOutput: false } },
        ],
      },
      prompt: {
        systemTemplate: '{schema}',
        userTemplate: '{text}',
      },
      extraction: DEFAULT_EXTRACTION_CONFIG,
    }

    const result = await extractStructuredData({
      config,
      schema: personSchema,
      text: 'Alice is 28 years old.',
      aiexDir: tempDir,
    })

    expect(result.success).toBe(true)
    expect(result.data).toEqual({ name: 'Alice', age: 28, city: null })
    expect(generateTextMock).toHaveBeenCalledTimes(2)

    // Inspect reflection prompt
    const secondCallArg = generateTextMock.mock.calls[1][0] as any
    expect(secondCallArg.system).toContain('You are a precise data correction assistant')
    expect(secondCallArg.system).toContain('If a value cannot be confirmed, set it to null')
    expect(secondCallArg.prompt).toContain('[Validation Error Details]')
    expect(secondCallArg.prompt).toContain('Do not invent missing facts')
    expect(secondCallArg.prompt).toContain('expected integer or null')
  })

  it('fails after max 3 attempts if the output remains invalid', async () => {
    const { extractStructuredData } = await import('@/core/ai-extraction/extractor')

    generateTextMock.mockResolvedValue({
      text: '{"name": "Alice", "age": "twenty-eight", "city": null}',
      usage: { inputTokens: 10, outputTokens: 5 },
    })

    const config = {
      provider: {
        baseURL: 'http://mock-url',
        apiKey: 'mock-key',
        models: [
          { name: 'mock-model', capabilities: { structuredOutput: false } },
        ],
      },
      prompt: {
        systemTemplate: '{schema}',
        userTemplate: '{text}',
      },
      extraction: DEFAULT_EXTRACTION_CONFIG,
    }

    const result = await extractStructuredData({
      config,
      schema: personSchema,
      text: 'Alice is 28 years old.',
      aiexDir: tempDir,
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('expected integer or null')
    expect(generateTextMock).toHaveBeenCalledTimes(3)
  })
})
