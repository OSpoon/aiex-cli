import type { AIModelConfig } from '@/core/ai-extraction/types'
import { describe, expect, it } from 'vitest'
import { lookupModelCapabilities } from '@/core/ai-extraction/capabilities'
import { maskApiKey } from '@/core/ai-extraction/config'
import { schemaToExtractionOutputSchema, validateExtractedData } from '@/core/ai-extraction/extractor'
import { safeParseJSON } from '@/core/ai-extraction/json-utils'
import { selectModel } from '@/core/ai-extraction/model-selector'
import {
  generateExtractionPrompt,
  generatePromptSnapshot,
  schemaToDescription,
} from '@/core/ai-extraction/prompt-generator'
import { AIConfigSchema } from '@/core/ai-extraction/schemas'
import { DEFAULT_PROMPT_CONFIG, PLACEHOLDER_SCHEMA, PLACEHOLDER_TEXT } from '@/core/ai-extraction/types'
import {
  annotatedSchema,
  emptySchema,
  flatSchema,
  inlineObjectSchema,
  nestedSchema,
} from './ai-extraction.test-utils'

// ───────────── Unit tests: schemaToExtractionOutputSchema ─────────────

describe('schemaToExtractionOutputSchema', () => {
  it('converts a user table schema into an extraction output schema', () => {
    const schema = schemaToExtractionOutputSchema(nestedSchema)

    expect(schema).toMatchObject({
      type: 'object',
      additionalProperties: false,
      required: ['name', 'address', 'orders'],
      properties: {
        name: { type: ['string', 'null'] },
        address: {
          type: ['object', 'null'],
          additionalProperties: false,
          required: ['street', 'city'],
          properties: {
            street: { type: ['string', 'null'] },
            city: { type: ['string', 'null'] },
          },
        },
        orders: {
          type: ['array', 'null'],
          items: {
            type: ['object', 'null'],
            additionalProperties: false,
            required: ['product', 'amount'],
            properties: {
              product: { type: ['string', 'null'] },
              amount: { type: ['number', 'null'] },
            },
          },
        },
      },
    })
  })

  it('does not leak aiex table-definition fields into AI output', () => {
    const schema = schemaToExtractionOutputSchema(flatSchema)
    const properties = schema.properties as Record<string, unknown>

    expect(schema).not.toHaveProperty('table')
    expect(schema).not.toHaveProperty('$defs')
    expect(properties).toHaveProperty('name')
    expect(properties).not.toHaveProperty('properties')
  })
})

// ───────────── Unit tests: validateExtractedData ─────────────

describe('validateExtractedData', () => {
  it('accepts complete data that matches the extraction schema', () => {
    const result = validateExtractedData(nestedSchema, {
      name: 'Alice',
      address: {
        street: 'Main St',
        city: 'Shanghai',
      },
      orders: [
        { product: 'Book', amount: 12.5 },
      ],
    })

    expect(result.success).toBe(true)
  })

  it('allows null values for missing source information', () => {
    const result = validateExtractedData(nestedSchema, {
      name: null,
      address: null,
      orders: null,
    })

    expect(result.success).toBe(true)
  })

  it('rejects unexpected fields before saving extracted data', () => {
    const result = validateExtractedData(flatSchema, {
      name: 'Alice',
      age: 32,
      unexpected: true,
    })

    expect(result.success).toBe(false)
    if (!result.success)
      expect(result.error).toContain('$.unexpected: unexpected field')
  })

  it('rejects missing fields and type mismatches', () => {
    const result = validateExtractedData(nestedSchema, {
      name: 'Alice',
      address: {
        street: 'Main St',
        city: 123,
      },
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error).toContain('$.address.city: expected string or null')
      expect(result.error).toContain('$.orders: missing field')
    }
  })
})

// ───────────── Unit tests: schemaToDescription ─────────────

describe('schemaToDescription', () => {
  it('describes flat schema with table name and required fields', () => {
    const desc = schemaToDescription(flatSchema)
    expect(desc).toContain('Table: person')
    expect(desc).toContain('Required: name')
    expect(desc).toContain('- name: string')
    expect(desc).toContain('- age: integer')
  })

  it('omits Required line when no required fields', () => {
    const desc = schemaToDescription(annotatedSchema)
    expect(desc).toContain('Table: profile')
    expect(desc).not.toContain('Required:')
  })

  it('includes annotations: format, unique, length, default, min/max', () => {
    const desc = schemaToDescription(annotatedSchema)
    expect(desc).toContain('format: email')
    expect(desc).toContain('unique: true')
    expect(desc).toContain('length: 10 - 1000')
    expect(desc).toContain('default: 0')
    expect(desc).toContain('tags: array of string')
  })

  it('describes nested object with has-one relation', () => {
    const desc = schemaToDescription(nestedSchema)
    expect(desc).toContain('- address: object (related table, has-one)')
    expect(desc).toContain('  - street: string')
    expect(desc).toContain('  - city: string')
  })

  it('describes nested array with has-many relation', () => {
    const desc = schemaToDescription(nestedSchema)
    expect(desc).toContain('- orders: array of object (related table, has-many)')
    expect(desc).toContain('  - product: string')
    expect(desc).toContain('  - amount: number')
  })

  it('describes inline object with child fields', () => {
    const desc = schemaToDescription(inlineObjectSchema)
    expect(desc).toContain('- address: object')
    expect(desc).toContain('  - street: string')
    expect(desc).toContain('  - city: string')
  })

  it('describes inline array with item fields', () => {
    const desc = schemaToDescription(inlineObjectSchema)
    expect(desc).toContain('- items: array of object')
    expect(desc).toContain('  item fields:')
    expect(desc).toContain('    - sku: string')
    expect(desc).toContain('    - qty: integer')
  })

  it('handles empty properties', () => {
    const desc = schemaToDescription(emptySchema)
    expect(desc).toContain('Table: empty')
    expect(desc).toContain('Fields:')
    expect(desc).not.toContain('Required:')
  })
})

// ───────────── Unit tests: generateExtractionPrompt ─────────────

describe('generateExtractionPrompt', () => {
  it('replaces {schema} and {text} placeholders', () => {
    const { system, user } = generateExtractionPrompt(flatSchema, 'hello world')
    expect(system).toContain('Table: person')
    expect(system).not.toContain(PLACEHOLDER_SCHEMA)
    expect(user).toContain('hello world')
    expect(user).not.toContain(PLACEHOLDER_TEXT)
  })

  it('replaces multiple {text} occurrences', () => {
    const promptConfig = {
      systemTemplate: 'fixed',
      userTemplate: `${PLACEHOLDER_TEXT} | ${PLACEHOLDER_TEXT}`,
    }
    const { user } = generateExtractionPrompt(flatSchema, 'data', promptConfig)
    expect(user).toBe('data | data')
  })

  it('replaces multiple {schema} occurrences', () => {
    const promptConfig = {
      systemTemplate: `${PLACEHOLDER_SCHEMA}\n---\n${PLACEHOLDER_SCHEMA}`,
      userTemplate: '{text}',
    }
    const { system } = generateExtractionPrompt(flatSchema, 'x', promptConfig)
    expect(system).toContain('Table: person')
    expect((system.match(/Table: person/g) || []).length).toBe(2)
  })

  it('uses default prompt config when none given', () => {
    const { system, user } = generateExtractionPrompt(flatSchema, 'test')
    expect(system).toContain('Table: person')
    expect(system).not.toContain(PLACEHOLDER_SCHEMA)
    expect(user).toBe(DEFAULT_PROMPT_CONFIG.userTemplate.replace(PLACEHOLDER_TEXT, 'test'))
  })
})

// ───────────── Unit tests: generatePromptSnapshot ─────────────

describe('generatePromptSnapshot', () => {
  it('generates markdown with table name and sections', () => {
    const md = generatePromptSnapshot(flatSchema)
    expect(md).toContain('# Prompt Snapshot')
    expect(md).toContain('Table: person')
    expect(md).toContain('## System Prompt')
    expect(md).toContain('## User Prompt Template')
    expect(md).toContain('Generated:')
    expect(md).toContain('{text}')
  })

  it('includes schema description in system section', () => {
    const md = generatePromptSnapshot(flatSchema)
    expect(md).toContain('- name: string')
    expect(md).toContain('- age: integer')
  })
})

// ───────────── Unit tests: maskApiKey ─────────────

describe('maskApiKey', () => {
  it('returns the key as-is (no masking)', () => {
    expect(maskApiKey('sk-abcdefghijklmnop')).toBe('sk-abcdefghijklmnop')
  })

  it('returns short key as-is', () => {
    expect(maskApiKey('abc')).toBe('abc')
    expect(maskApiKey('abcd')).toBe('abcd')
  })

  it('returns empty string as-is', () => {
    expect(maskApiKey('')).toBe('')
  })
})

// ───────────── Unit tests: AIConfigSchema ─────────────

describe('ai config schema', () => {
  const validConfig = {
    provider: {
      baseURL: 'http://localhost:11434/v1',
      apiKey: '',
      models: [
        { name: 'llama3.2', capabilities: { vision: false, structuredOutput: false } },
        { name: 'llava', capabilities: { vision: true, structuredOutput: false } },
      ],
    },
    prompt: { systemTemplate: '{schema}', userTemplate: '{text}' },
    extraction: { outputDir: '.aiex/extracted' },
  }

  it('accepts valid config', () => {
    const result = AIConfigSchema.parse(validConfig)
    expect(result.provider.models).toHaveLength(2)
    expect(result.provider.models[0].name).toBeTruthy()
    expect(result.provider.models[0].name).toEqual(expect.any(String))
  })

  it('accepts mineru pdf converter config', () => {
    const result = AIConfigSchema.parse({
      ...validConfig,
      pdf: {
        converter: 'mineru',
        mineru: {
          command: 'mineru',
          args: ['-p', '{input}', '-o', '{outputDir}'],
          timeout: 600,
          fallbackToUnpdf: true,
        },
      },
    })

    expect(result.pdf?.converter).toBe('mineru')
    expect(result.pdf?.mineru?.args).toEqual(['-p', '{input}', '-o', '{outputDir}'])
  })

  it('rejects empty mineru command', () => {
    expect(() => AIConfigSchema.parse({
      ...validConfig,
      pdf: {
        converter: 'mineru',
        mineru: { command: '', args: [] },
      },
    })).toThrow()
  })

  it('accepts config with single model', () => {
    const result = AIConfigSchema.parse({
      ...validConfig,
      provider: { ...validConfig.provider, models: [validConfig.provider.models[0]] },
    })
    expect(result.provider.models).toHaveLength(1)
  })

  it('rejects config with zero models', () => {
    expect(() => AIConfigSchema.parse({
      ...validConfig,
      provider: { ...validConfig.provider, models: [] },
    })).toThrow()
  })

  it('rejects empty baseURL', () => {
    expect(() => AIConfigSchema.parse({
      ...validConfig,
      provider: { ...validConfig.provider, baseURL: '' },
    })).toThrow()
  })

  it('accepts config with maxTokens in capabilities', () => {
    const result = AIConfigSchema.parse({
      ...validConfig,
      provider: {
        ...validConfig.provider,
        models: [{ name: 'gpt-4', capabilities: { vision: false, structuredOutput: true, maxTokens: 128000 } }],
      },
    })
    expect(result.provider.models[0].capabilities.maxTokens).toBe(128000)
  })

  it('rejects negative maxTokens', () => {
    expect(() => AIConfigSchema.parse({
      ...validConfig,
      provider: {
        ...validConfig.provider,
        models: [{ name: 'gpt-4', capabilities: { vision: false, structuredOutput: true, maxTokens: -1 } }],
      },
    })).toThrow()
  })

  it('rejects empty model name', () => {
    expect(() => AIConfigSchema.parse({
      ...validConfig,
      provider: { ...validConfig.provider, models: [{ name: '', capabilities: { vision: false, structuredOutput: false } }] },
    })).toThrow()
  })

  it('rejects empty systemTemplate', () => {
    expect(() => AIConfigSchema.parse({
      ...validConfig,
      prompt: { ...validConfig.prompt, systemTemplate: '' },
    })).toThrow()
  })
})

// ───────────── Unit tests: registry lookup ─────────────

describe('lookupModelCapabilities', () => {
  it('finds gpt-4o by exact name (vision + structured output)', () => {
    const caps = lookupModelCapabilities('gpt-4o')
    expect(caps).not.toBeNull()
    expect(caps!.vision).toBe(true)
    expect(caps!.structuredOutput).toBe(true)
  })

  it('finds gpt-4-turbo by exact name (vision, no structured output)', () => {
    const caps = lookupModelCapabilities('gpt-4-turbo')
    expect(caps).not.toBeNull()
    expect(caps!.vision).toBe(true)
    expect(caps!.structuredOutput).toBe(false)
  })

  it('finds gpt-3.5-turbo (no vision, no structured output)', () => {
    const caps = lookupModelCapabilities('gpt-3.5-turbo')
    expect(caps).not.toBeNull()
    expect(caps!.vision).toBe(false)
    expect(caps!.structuredOutput).toBe(false)
  })

  it('returns null for unknown model', () => {
    const caps = lookupModelCapabilities('nonexistent-model-12345')
    expect(caps).toBeNull()
  })
})

// ───────────── Unit tests: selectModel ─────────────

describe('selectModel', () => {
  const visionModel: AIModelConfig = { name: 'vision-model', capabilities: { vision: true, structuredOutput: true } }
  const textSO: AIModelConfig = { name: 'text-so', capabilities: { vision: false, structuredOutput: true } }
  const textOnly: AIModelConfig = { name: 'text-only', capabilities: { vision: false, structuredOutput: false } }

  it('selects vision model when image is provided', () => {
    const result = selectModel({ models: [textSO, visionModel], isImage: true, fileName: 'test.png' })
    expect(result.name).toBe('vision-model')
  })

  it('selects structured output model for text input', () => {
    const result = selectModel({ models: [textOnly, textSO], isImage: false })
    expect(result.name).toBe('text-so')
  })

  it('selects structured output model for non-image file input (e.g. PDF)', () => {
    const result = selectModel({ models: [textSO, visionModel], isImage: false, fileName: 'doc.pdf' })
    expect(result.name).toBe('text-so')
  })

  it('falls back to first model when no structured output model exists', () => {
    const result = selectModel({ models: [textOnly], isImage: false })
    expect(result.name).toBe('text-only')
  })

  it('throws when image is provided but no vision model exists', () => {
    expect(() => selectModel({ models: [textSO], isImage: true, fileName: 'photo.png' }))
      .toThrow(/vision/)
  })

  it('does NOT throw for non-image file when no vision model exists', () => {
    const result = selectModel({ models: [textSO], isImage: false, fileName: 'doc.pdf' })
    expect(result.name).toBe('text-so')
  })

  it('throws when models list is empty', () => {
    expect(() => selectModel({ models: [], isImage: false }))
      .toThrow(/No AI models/)
  })

  it('picks first vision model when multiple exist', () => {
    const models = [
      { name: 'gpt-4', capabilities: { vision: false, structuredOutput: true } },
      { name: 'gpt-4-vision', capabilities: { vision: true, structuredOutput: true } },
      { name: 'claude-vision', capabilities: { vision: true, structuredOutput: true } },
    ]
    const result = selectModel({ models, isImage: true })
    expect(result.name).toBe('gpt-4-vision')
  })

  it('filters models with insufficient context window for long text', () => {
    const models: AIModelConfig[] = [
      { name: 'small', capabilities: { vision: false, structuredOutput: true, maxTokens: 1000 } },
      { name: 'large', capabilities: { vision: false, structuredOutput: true, maxTokens: 10000 } },
    ]
    const result = selectModel({ models, isImage: false, inputTokens: 2000 })
    expect(result.name).toBe('large')
  })

  it('filters vision models with insufficient context window for image inputs', () => {
    const models: AIModelConfig[] = [
      { name: 'small-vision', capabilities: { vision: true, structuredOutput: true, maxTokens: 500 } },
      { name: 'large-vision', capabilities: { vision: true, structuredOutput: true, maxTokens: 5000 } },
    ]
    const result = selectModel({ models, isImage: true, fileName: 'test.png', inputTokens: 1000 })
    expect(result.name).toBe('large-vision')
  })

  it('falls back to all models when none can fit inputTokens (best effort)', () => {
    const models: AIModelConfig[] = [
      { name: 'tiny', capabilities: { vision: false, structuredOutput: false, maxTokens: 100 } },
    ]
    const result = selectModel({ models, isImage: false, inputTokens: 500 })
    expect(result.name).toBe('tiny')
  })

  it('ignores context filter when inputTokens is not provided', () => {
    const models: AIModelConfig[] = [
      { name: 'tiny', capabilities: { vision: false, structuredOutput: false, maxTokens: 100 } },
      { name: 'large', capabilities: { vision: false, structuredOutput: true, maxTokens: 10000 } },
    ]
    const result = selectModel({ models, isImage: false })
    expect(result.name).toBe('large')
  })

  it('uses models without maxTokens as compatible candidates', () => {
    const models: AIModelConfig[] = [
      { name: 'unknown', capabilities: { vision: false, structuredOutput: true } },
      { name: 'small', capabilities: { vision: false, structuredOutput: false, maxTokens: 100 } },
    ]
    const result = selectModel({ models, isImage: false, inputTokens: 500 })
    expect(result.name).toBe('unknown')
  })

  it('filters models with insufficient output tokens', () => {
    const models: AIModelConfig[] = [
      { name: 'small-out', capabilities: { vision: false, structuredOutput: true, maxOutputTokens: 200 } },
      { name: 'large-out', capabilities: { vision: false, structuredOutput: true, maxOutputTokens: 5000 } },
    ]
    const result = selectModel({ models, isImage: false, outputTokens: 1000 })
    expect(result.name).toBe('large-out')
  })

  it('uses models without maxOutputTokens as compatible candidates', () => {
    const models: AIModelConfig[] = [
      { name: 'unknown', capabilities: { vision: false, structuredOutput: true } },
      { name: 'small', capabilities: { vision: false, structuredOutput: true, maxOutputTokens: 100 } },
    ]
    const result = selectModel({ models, isImage: false, outputTokens: 500 })
    expect(result.name).toBe('unknown')
  })

  it('filters by both input and output tokens simultaneously', () => {
    const models: AIModelConfig[] = [
      { name: 'a', capabilities: { vision: false, structuredOutput: true, maxTokens: 500, maxOutputTokens: 5000 } },
      { name: 'b', capabilities: { vision: false, structuredOutput: true, maxTokens: 5000, maxOutputTokens: 200 } },
      { name: 'c', capabilities: { vision: false, structuredOutput: true, maxTokens: 10000, maxOutputTokens: 10000 } },
    ]
    const result = selectModel({ models, isImage: false, inputTokens: 2000, outputTokens: 1000 })
    expect(result.name).toBe('c')
  })
})

// ───────────── Unit tests: safeParseJSON ─────────────

describe('safeParseJSON', () => {
  it('parses clean JSON object', () => {
    expect(safeParseJSON('{"name":"Alice","age":30}')).toEqual({ name: 'Alice', age: 30 })
  })

  it('parses clean JSON array', () => {
    expect(safeParseJSON('[1, 2, 3]')).toEqual([1, 2, 3])
  })

  it('strips markdown code fences', () => {
    const result = safeParseJSON('```json\n{"key": "value"}\n```')
    expect(result).toEqual({ key: 'value' })
  })

  it('strips markdown fences without language tag', () => {
    const result = safeParseJSON('```\n{"key": "value"}\n```')
    expect(result).toEqual({ key: 'value' })
  })

  it('extracts JSON from text with leading content', () => {
    const result = safeParseJSON('Here is the data:\n{"name":"Bob","age":25}')
    expect(result).toEqual({ name: 'Bob', age: 25 })
  })

  it('extracts JSON from text with trailing content', () => {
    const result = safeParseJSON('{"name":"Bob","age":25}\n\nThat is the extracted data.')
    expect(result).toEqual({ name: 'Bob', age: 25 })
  })

  it('repairs common non-strict JSON from model output', () => {
    const result = safeParseJSON(`{
      name: 'Bob',
      age: 25,
    }`)
    expect(result).toEqual({ name: 'Bob', age: 25 })
  })

  it('throws on completely invalid text', () => {
    expect(() => safeParseJSON('not json at all')).toThrow(/Failed to parse JSON/)
  })

  it('throws on empty string', () => {
    expect(() => safeParseJSON('')).toThrow(/Failed to parse JSON/)
  })

  it('truncates long raw output in error message', () => {
    const long = 'a'.repeat(500)
    expect(() => safeParseJSON(long)).toThrow(/\.\.\.$/)
    expect(() => safeParseJSON(long)).not.toThrow(long)
  })
})
