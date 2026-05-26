import type { AIConfig, AIModelConfig, JsonSchemaDefinition } from '@/types'
import { DEFAULT_EXTRACTION_CONFIG, DEFAULT_PROMPT_CONFIG } from '@/core/ai-extraction/types'

// ─── Provider ───

export const TEST_BASE_URL = 'http://localhost:11434/v1'
export const TEST_API_KEY = ''
export const TEST_MODEL = 'llama3.2'
export const TEST_VISION_MODEL = 'llava'

export const TEST_MODEL_TEXT: AIModelConfig = {
  name: TEST_MODEL,
  capabilities: { vision: false, structuredOutput: false },
}

export const TEST_MODEL_VISION: AIModelConfig = {
  name: TEST_VISION_MODEL,
  capabilities: { vision: true, structuredOutput: false },
}

export const TEST_AI_CONFIG: AIConfig = {
  provider: {
    baseURL: TEST_BASE_URL,
    apiKey: TEST_API_KEY,
    models: [TEST_MODEL_TEXT, TEST_MODEL_VISION],
  },
  prompt: DEFAULT_PROMPT_CONFIG,
  extraction: DEFAULT_EXTRACTION_CONFIG,
}

// ─── Schema fixtures ───

export const flatSchema = {
  title: 'Person',
  type: 'object' as const,
  properties: {
    name: { type: 'string' as const },
    age: { type: 'integer' as const },
  },
  required: ['name'],
  table: { name: 'person' },
} satisfies JsonSchemaDefinition

export const annotatedSchema = {
  title: 'Profile',
  type: 'object' as const,
  properties: {
    email: { type: 'string' as const, format: 'email', unique: true },
    bio: { type: 'string' as const, minLength: 10, maxLength: 1000 },
    score: { type: 'integer' as const, default: 0, minimum: 0, maximum: 100 },
    tags: { type: 'array' as const, items: { type: 'string' as const } },
    metadata: { type: 'object' as const, properties: { key: { type: 'string' as const } } },
  },
  table: { name: 'profile' },
} satisfies JsonSchemaDefinition

export const nestedSchema = {
  title: 'Customer',
  type: 'object' as const,
  properties: {
    name: { type: 'string' as const },
    address: {
      type: 'object' as const,
      properties: {
        street: { type: 'string' as const },
        city: { type: 'string' as const },
      },
      nested: { enabled: true, relation: 'has-one' },
    },
    orders: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        properties: {
          product: { type: 'string' as const },
          amount: { type: 'number' as const },
        },
        nested: { enabled: true, relation: 'has-many' },
      },
    },
  },
  required: ['name'],
  table: { name: 'customer' },
} satisfies JsonSchemaDefinition

export const inlineObjectSchema = {
  title: 'Inline Test',
  type: 'object' as const,
  properties: {
    name: { type: 'string' as const },
    address: {
      type: 'object' as const,
      properties: {
        street: { type: 'string' as const },
        city: { type: 'string' as const },
      },
    },
    items: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        properties: {
          sku: { type: 'string' as const },
          qty: { type: 'integer' as const },
        },
      },
    },
  },
  table: { name: 'inline_test' },
} satisfies JsonSchemaDefinition

export const emptySchema = {
  title: 'Empty',
  type: 'object' as const,
  properties: {},
  table: { name: 'empty' },
} satisfies JsonSchemaDefinition

export const paperSchema = {
  title: 'Paper Metadata',
  type: 'object' as const,
  properties: {
    title: { type: 'string' as const },
    firstAuthor: { type: 'string' as const },
    journal: { type: 'string' as const },
    year: { type: 'integer' as const },
  },
  required: ['title', 'firstAuthor', 'journal', 'year'],
  table: { name: 'paper' },
} satisfies JsonSchemaDefinition

export const personSchema = {
  title: 'Person',
  type: 'object' as const,
  properties: {
    name: { type: 'string' as const },
    age: { type: 'integer' as const },
    city: { type: 'string' as const },
  },
  required: ['name', 'age'],
  table: { name: 'person' },
} satisfies JsonSchemaDefinition
