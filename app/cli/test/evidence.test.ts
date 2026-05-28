import type { JsonSchemaDefinition } from '@/domain/schema/schemas'
import { describe, expect, it } from 'vitest'
import { stripEvidence, verifyFieldEvidence } from '@/domain/ai-extraction/evidence'

describe('stripEvidence', () => {
  it('should return data as-is when no _evidence key', () => {
    const data = { name: 'Alice', age: 30 }
    expect(stripEvidence(data)).toEqual({ data })
  })

  it('should strip _evidence and return rawEvidence', () => {
    const data = {
      name: 'Alice',
      _evidence: {
        name: { quote: 'Alice' },
      },
    }
    const result = stripEvidence(data)
    expect(result.data).toEqual({ name: 'Alice' })
    expect(result.rawEvidence).toEqual({ name: { quote: 'Alice' } })
  })

  it('should handle null data', () => {
    expect(stripEvidence(null)).toEqual({ data: null })
  })

  it('should handle array data', () => {
    expect(stripEvidence([1, 2, 3])).toEqual({ data: [1, 2, 3] })
  })

  it('should skip non-record _evidence values', () => {
    const data = {
      name: 'Alice',
      _evidence: 'string',
    }
    const result = stripEvidence(data)
    expect(result.data).toEqual({ name: 'Alice' })
    expect(result.rawEvidence).toBeUndefined()
  })

  it('should filter out non-record items in _evidence', () => {
    const data = {
      name: 'Alice',
      _evidence: {
        name: { quote: 'Alice' },
        bad: 'not a record',
      },
    }
    const result = stripEvidence(data)
    expect(result.rawEvidence).toEqual({ name: { quote: 'Alice' } })
  })
})

describe('verifyFieldEvidence', () => {
  const schema: JsonSchemaDefinition = {
    title: 'Person',
    type: 'object',
    table: { name: 'people' },
    properties: {
      name: { type: 'string' },
      age: { type: 'integer' },
      score: { type: 'number' },
    },
  }

  it('should verify string evidence found in source text', () => {
    const result = verifyFieldEvidence({
      schema,
      text: 'Alice is 30 years old with a score of 95.5',
      data: { name: 'Alice', age: 30, score: 95.5 },
      rawEvidence: {
        name: { quote: 'Alice' },
      },
    })
    expect(result).toBeDefined()
    expect(result!.name).toMatchObject({
      quote: 'Alice',
      verified: true,
      matchMethod: 'exact_unique',
    })
  })

  it('should return undefined when text is empty', () => {
    const result = verifyFieldEvidence({
      schema,
      text: '',
      data: { name: 'Alice' },
      rawEvidence: { name: { quote: 'Alice' } },
    })
    expect(result).toBeUndefined()
  })

  it('should return undefined when data is not a record', () => {
    const result = verifyFieldEvidence({
      schema,
      text: 'some text',
      data: null,
      rawEvidence: { name: { quote: 'Alice' } },
    })
    expect(result).toBeUndefined()
  })

  it('should return undefined when rawEvidence is empty', () => {
    const result = verifyFieldEvidence({
      schema,
      text: 'Alice is 30',
      data: { name: 'Alice', age: 30 },
    })
    expect(result).toBeUndefined()
  })

  it('should skip evidence for fields not in schema properties', () => {
    const result = verifyFieldEvidence({
      schema,
      text: 'Alice is 30',
      data: { unknownField: 'value' },
      rawEvidence: { unknownField: { quote: 'value' } },
    })
    expect(result).toBeUndefined()
  })

  it('should skip evidence for non-string/number property types', () => {
    const schemaWithBool: JsonSchemaDefinition = {
      title: 'Test',
      type: 'object',
      table: { name: 'test' },
      properties: {
        active: { type: 'boolean' },
      },
    }
    const result = verifyFieldEvidence({
      schema: schemaWithBool,
      text: 'Active is true',
      data: { active: true },
      rawEvidence: { active: { quote: 'true' } },
    })
    expect(result).toBeUndefined()
  })

  it('should skip evidence with non-string quote', () => {
    const result = verifyFieldEvidence({
      schema,
      text: 'Alice is 30',
      data: { name: 'Alice' },
      rawEvidence: { name: { quote: 123 as any } },
    })
    expect(result).toBeUndefined()
  })

  it('should verify numeric evidence', () => {
    const result = verifyFieldEvidence({
      schema,
      text: 'Alice is 30 years old with a score of 95.5',
      data: { name: 'Alice', age: 30, score: 95.5 },
      rawEvidence: {
        age: { quote: '30' },
        score: { quote: '95.5' },
      },
    })
    expect(result).toBeDefined()
    expect(result!.age).toBeDefined()
    expect(result!.score).toBeDefined()
  })

  it('should handle non-unique quotes (multiple occurrences)', () => {
    const result = verifyFieldEvidence({
      schema,
      text: 'Alice Bob Alice',
      data: { name: 'Alice' },
      rawEvidence: { name: { quote: 'Alice' } },
    })
    expect(result).toBeUndefined()
  })

  it('should verify number from normalized string', () => {
    const result = verifyFieldEvidence({
      schema,
      text: 'Revenue was 1,234,567',
      data: { score: 1234567 },
      rawEvidence: { score: { quote: '1,234,567' } },
    })
    expect(result).toBeDefined()
  })
})
