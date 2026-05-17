import type { AIModelConfig } from '@/core/ai-extraction/types'
import { describe, expect, it } from 'vitest'
import { lookupModelCapabilities } from '@/core/ai-extraction/capabilities'
import { maskApiKey } from '@/core/ai-extraction/config'
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
  it('masks key longer than 4 chars, showing sk-*** + last 4', () => {
    expect(maskApiKey('sk-abcdefghijklmnop')).toBe('sk-***mnop')
  })

  it('returns **** for key <= 4 chars', () => {
    expect(maskApiKey('abc')).toBe('****')
    expect(maskApiKey('abcd')).toBe('****')
  })

  it('returns **** for empty string', () => {
    expect(maskApiKey('')).toBe('****')
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
