import type { JsonSchemaDefinition } from '@/domain/schema/schemas'
import { describe, expect, it } from 'vitest'
import { generateExtractionPrompt, generatePromptSnapshot, schemaToDescription } from '@/domain/ai-extraction/prompt-generator'
import { annotatedSchema, emptySchema, flatSchema, nestedSchema } from './ai-extraction.test-utils'

describe('prompt-generator', () => {
  describe('schemaToDescription', () => {
    it('generates description for flat schema', () => {
      const desc = schemaToDescription(flatSchema)
      expect(desc).toContain('Table: person')
      expect(desc).toContain('- name: string')
      expect(desc).toContain('- age: integer')
    })

    it('generates description with required fields', () => {
      const desc = schemaToDescription(flatSchema)
      expect(desc).toContain('Required: name')
    })

    it('handles empty schema', () => {
      const desc = schemaToDescription(emptySchema)
      expect(desc).toContain('Table: empty')
      expect(desc).not.toContain('Required:')
    })

    it('includes constraints in description', () => {
      const desc = schemaToDescription(annotatedSchema)
      expect(desc).toContain('format: email')
      expect(desc).toContain('unique: true')
      expect(desc).toContain('length: 10 - 1000')
      expect(desc).toContain('default: 0')
    })

    it('describes nested relations', () => {
      const desc = schemaToDescription(nestedSchema)
      expect(desc).toContain('address: object (related table, has-one)')
      expect(desc).toContain('orders: array of object (related table, has-many)')
      expect(desc).toContain('street: string')
      expect(desc).toContain('amount: number')
    })

    it('describes array types', () => {
      const schema = {
        title: 'Test',
        type: 'object' as const,
        properties: {
          tags: { type: 'array' as const, items: { type: 'string' as const } },
        },
        table: { name: 'test' },
      } satisfies JsonSchemaDefinition
      const desc = schemaToDescription(schema)
      expect(desc).toContain('tags: array of string')
    })

    it('describes examples/few-shot cases if present', () => {
      const schema: JsonSchemaDefinition = {
        title: 'Test',
        type: 'object' as const,
        properties: {
          name: { type: 'string' as const },
        },
        table: { name: 'test' },
        examples: [
          {
            text: 'Alice is here',
            output: { name: 'Alice' },
          },
        ],
      }
      const desc = schemaToDescription(schema)
      expect(desc).toContain('Examples / Few-shot Cases:')
      expect(desc).toContain('Example 1:')
      expect(desc).toContain('Alice is here')
      expect(desc).toContain('"name": "Alice"')
    })

    it('renders description on field', () => {
      const schema: JsonSchemaDefinition = {
        title: 'Test',
        type: 'object',
        properties: {
          email: { type: 'string', description: '用户邮箱地址' },
        },
        table: { name: 'test' },
      }
      const desc = schemaToDescription(schema)
      expect(desc).toContain('description: 用户邮箱地址')
    })

    it('renders enum values', () => {
      const schema: JsonSchemaDefinition = {
        title: 'Test',
        type: 'object',
        properties: {
          size: { type: 'string', enum: ['small', 'medium', 'large'] },
        },
        table: { name: 'test' },
      }
      const desc = schemaToDescription(schema)
      expect(desc).toContain('allowed values: "small", "medium", "large"')
    })

    it('renders pattern', () => {
      const schema: JsonSchemaDefinition = {
        title: 'Test',
        type: 'object',
        properties: {
          code: { type: 'string', pattern: '^INV-\\d{6}$' },
        },
        table: { name: 'test' },
      }
      const desc = schemaToDescription(schema)
      expect(desc).toContain('pattern: ^INV-\\d{6}$')
    })

    it('renders numeric range from minimum/maximum', () => {
      const schema: JsonSchemaDefinition = {
        title: 'Test',
        type: 'object',
        properties: {
          age: { type: 'integer', minimum: 0, maximum: 150 },
        },
        table: { name: 'test' },
      }
      const desc = schemaToDescription(schema)
      expect(desc).toContain('range: 0 - 150')
    })

    it('renders field-level examples', () => {
      const schema: JsonSchemaDefinition = {
        title: 'Test',
        type: 'object',
        properties: {
          name: { type: 'string', examples: ['Alice', 'Bob'] },
        },
        table: { name: 'test' },
      }
      const desc = schemaToDescription(schema)
      expect(desc).toContain('examples: "Alice", "Bob"')
    })

    it('renders xPrompt as extraction hint', () => {
      const schema: JsonSchemaDefinition = {
        title: 'Test',
        type: 'object',
        properties: {
          invoiceNo: { type: 'string', xPrompt: '查找以 INV- 开头的编号' },
        },
        table: { name: 'test' },
      }
      const desc = schemaToDescription(schema)
      expect(desc).toContain('extraction hint: 查找以 INV- 开头的编号')
    })

    it('renders primary key tag inline', () => {
      const schema: JsonSchemaDefinition = {
        title: 'Test',
        type: 'object',
        properties: {
          id: { type: 'integer', primary: true },
        },
        table: { name: 'test' },
      }
      const desc = schemaToDescription(schema)
      expect(desc).toContain('id: integer (primary key)')
    })

    it('renders all annotations together on one field', () => {
      const schema: JsonSchemaDefinition = {
        title: 'Invoice',
        type: 'object',
        properties: {
          invoiceNo: {
            type: 'string',
            primary: true,
            description: '发票号码，格式 INV-xxxxxx',
            pattern: '^INV-\\d{6}$',
            minLength: 6,
            maxLength: 10,
            examples: ['INV-202401'],
            xPrompt: '查找以 INV- 开头的 6 位数字编号',
          },
        },
        table: { name: 'invoices' },
      }
      const desc = schemaToDescription(schema)
      expect(desc).toContain('invoiceNo: string (primary key)')
      expect(desc).toContain('description: 发票号码，格式 INV-xxxxxx')
      expect(desc).toContain('pattern: ^INV-\\d{6}$')
      expect(desc).toContain('length: 6 - 10')
      expect(desc).toContain('examples: "INV-202401"')
      expect(desc).toContain('extraction hint: 查找以 INV- 开头的 6 位数字编号')
    })
  })

  describe('generateExtractionPrompt', () => {
    it('replaces placeholders in system prompt', () => {
      const { system } = generateExtractionPrompt(flatSchema, 'John, 30')
      expect(system).toContain('person')
      expect(system).toContain('name: string')
      expect(system).not.toContain('{schema}')
    })

    it('replaces placeholders in user prompt', () => {
      const { user } = generateExtractionPrompt(flatSchema, 'John, 30')
      expect(user).toContain('John, 30')
      expect(user).not.toContain('{text}')
    })

    it('uses custom prompt config', () => {
      const customConfig = {
        systemTemplate: 'Custom system {schema}',
        userTemplate: 'Custom user {text}',
      }
      const { system, user } = generateExtractionPrompt(flatSchema, 'data', customConfig)
      expect(system).toBe(`Custom system ${schemaToDescription(flatSchema)}`)
      expect(user).toBe('Custom user data')
    })
  })

  describe('generatePromptSnapshot', () => {
    it('generates snapshot with metadata', () => {
      const snapshot = generatePromptSnapshot(flatSchema)
      expect(snapshot).toContain('# Prompt Snapshot')
      expect(snapshot).toContain('Table: person')
      expect(snapshot).toContain('Generated:')
      expect(snapshot).toContain('## System Prompt')
      expect(snapshot).toContain('## User Prompt Template')
    })

    it('preserves {text} placeholder in snapshot', () => {
      const snapshot = generatePromptSnapshot(flatSchema)
      expect(snapshot).toContain('{text}')
    })
  })
})
