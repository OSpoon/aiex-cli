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
  hasToolCall: vi.fn((toolName: string) => ({ type: 'has-tool-call', toolName })),
  isLoopFinished: vi.fn(() => ({ type: 'loop-finished' })),
  stepCountIs: vi.fn((count: number) => ({ type: 'step-count', count })),
  ToolLoopAgent: vi.fn(function ToolLoopAgent(this: any, options: any) {
    this.generate = (input: any) => generateTextMock({ ...options, ...input, system: options.instructions })
  }),
  tool: vi.fn(options => options),
}))

describe('reAct Agent Mode in extractStructuredDataWithAgent', () => {
  let tempDir = ''

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aiex-react-test-'))
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

  it('runs ReAct agent loop, executes tools successfully, and extracts correct data', async () => {
    const { extractStructuredDataWithAgent } = await import('@/core/ai-extraction/react-agent')

    // Mock generateText to simulate agent executing tools and submitting data
    generateTextMock.mockImplementation(async (options: any) => {
      // Simulates agent reasoning steps calling tools
      const listChunksResult = await options.tools.listChunks.execute({})
      expect(listChunksResult).toHaveLength(1)
      expect(listChunksResult[0]).toMatchObject({ id: 1, size: 22 })

      const readChunkResult = await options.tools.readChunk.execute({ chunkId: 1 })
      expect(readChunkResult.content).toBe('Alice is 28 years old.')

      const searchResult = await options.tools.searchChunks.execute({ query: 'Alice' })
      expect(searchResult).toHaveLength(1)
      expect(searchResult[0].chunkId).toBe(1)
      expect(searchResult[0].offset).toBe(0)

      const rangeResult = await options.tools.readChunkRange.execute({ chunkId: 1, start: 0, length: 5 })
      expect(rangeResult.content).toBe('Alice')

      const submitResult = await options.tools.submitExtraction.execute({
        data: { name: 'Alice', age: 28, city: 'Shanghai' },
        evidence: {
          '$.name': {
            status: 'found',
            chunkId: 1,
            snippet: 'Alice is 28 years old.',
            confidence: 0.9,
          },
        },
      })
      expect(submitResult.status).toBe('success')
      expect(submitResult.evidenceCount).toBe(1)

      return {
        text: 'Finished extracting Alice data.',
        usage: { inputTokens: 40, outputTokens: 20 },
      }
    })

    const config = {
      provider: {
        baseURL: 'http://mock-url',
        apiKey: 'mock-key',
        models: [
          { name: 'mock-model', capabilities: { vision: false, structuredOutput: false } },
        ],
      },
      prompt: {
        systemTemplate: '{schema}',
        userTemplate: '{text}',
      },
      extraction: DEFAULT_EXTRACTION_CONFIG,
    }

    const result = await extractStructuredDataWithAgent({
      config,
      schema: personSchema,
      text: 'Alice is 28 years old.',
      aiexDir: tempDir,
    })

    expect(result.success).toBe(true)
    expect(result.data).toEqual({ name: 'Alice', age: 28, city: 'Shanghai' })
    expect(result.tokensUsed).toEqual({
      prompt: 40,
      completion: 20,
      total: 60,
    })
    expect(generateTextMock).toHaveBeenCalledTimes(1)

    const outputFiles = await fs.readdir(path.join(tempDir, 'extracted'))
    expect(outputFiles.some(file => file.endsWith('.agent-trace.json'))).toBe(true)
    expect(outputFiles.some(file => file.endsWith('.evidence.json'))).toBe(true)

    const evidenceFile = outputFiles.find(file => file.endsWith('.evidence.json'))
    expect(evidenceFile).toBeTruthy()
    const evidence = JSON.parse(await fs.readFile(path.join(tempDir, 'extracted', evidenceFile!), 'utf8'))
    expect(evidence.coverage.fieldCount).toBeGreaterThan(0)
    expect(evidence.coverage.evidenceCount).toBeGreaterThan(0)
  })

  it('triggers self-reflection loop in agent mode if submitted data fails validation', async () => {
    const { extractStructuredDataWithAgent } = await import('@/core/ai-extraction/react-agent')

    generateTextMock
      // First call (main agent execution): agent submits invalid age type "twenty-eight"
      .mockImplementationOnce(async (options: any) => {
        await options.tools.submitExtraction.execute({
          data: { name: 'Alice', age: 'twenty-eight', city: null },
        })
        return {
          text: 'Submitted data.',
          usage: { promptTokens: 30, completionTokens: 15 },
        }
      })
      // Second call (correction step): returns corrected data
      .mockResolvedValueOnce({
        text: '{"name": "Alice", "age": 28, "city": null}',
        usage: { promptTokens: 10, completionTokens: 5 },
      })

    const config = {
      provider: {
        baseURL: 'http://mock-url',
        apiKey: 'mock-key',
        models: [
          { name: 'mock-model', capabilities: { vision: false, structuredOutput: false } },
        ],
      },
      prompt: {
        systemTemplate: '{schema}',
        userTemplate: '{text}',
      },
      extraction: DEFAULT_EXTRACTION_CONFIG,
    }

    const result = await extractStructuredDataWithAgent({
      config,
      schema: personSchema,
      text: 'Alice is 28 years old.',
      aiexDir: tempDir,
    })

    expect(result.success).toBe(true)
    expect(result.data).toEqual({ name: 'Alice', age: 28, city: null })
    expect(generateTextMock).toHaveBeenCalledTimes(2)

    const correctionCall = generateTextMock.mock.calls[1][0] as any
    expect(correctionCall.system).toContain('You are a precise data correction assistant')
    expect(correctionCall.system).toContain('Validation Errors:')
    expect(correctionCall.system).toContain('expected integer or null')
    expect(result.tokensUsed).toEqual({
      prompt: 40,
      completion: 20,
      total: 60,
    })
  })

  it('rejects models explicitly configured without tool calling support', async () => {
    const { extractStructuredDataWithAgent } = await import('@/core/ai-extraction/react-agent')

    const config = {
      provider: {
        baseURL: 'http://mock-url',
        apiKey: 'mock-key',
        models: [
          { name: 'no-tools-model', capabilities: { vision: false, structuredOutput: false, supportsTools: false } },
        ],
      },
      prompt: {
        systemTemplate: '{schema}',
        userTemplate: '{text}',
      },
      extraction: DEFAULT_EXTRACTION_CONFIG,
    }

    const result = await extractStructuredDataWithAgent({
      config,
      schema: personSchema,
      text: 'Alice is 28 years old.',
      aiexDir: tempDir,
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('requires a model that supports tool calling')
    expect(generateTextMock).not.toHaveBeenCalled()
  })
})
