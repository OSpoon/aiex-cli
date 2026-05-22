import type { JsonSchemaDefinition } from '@/core/schema-sqlite/schemas'
import { describe, expect, it } from 'vitest'
import { generateExtractionPrompt, generatePromptSnapshot, schemaToDescription } from '@/core/ai-extraction/prompt-generator'
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
