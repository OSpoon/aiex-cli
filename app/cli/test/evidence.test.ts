import type { JsonSchemaDefinition } from '@/domain/schema/schemas'
import { describe, expect, it } from 'vitest'
import { buildFieldEvidenceQuality, findInvalidFieldEvidence, stripEvidence, verifyFieldEvidence } from '@/domain/ai-extraction/evidence'

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

  it('does not treat repeated matching quotes as invalid evidence', () => {
    const data = { age: 30 }
    const rawEvidence = { age: { quote: '30' } }
    const text = 'Alice is 30. Bob is also 30.'
    const verifiedEvidence = verifyFieldEvidence({
      schema,
      text,
      data,
      rawEvidence,
    })
    const invalidEvidenceFields = findInvalidFieldEvidence({
      schema,
      text,
      data,
      rawEvidence,
    })
    const quality = buildFieldEvidenceQuality({
      schema,
      data,
      rawEvidence,
      verifiedEvidence,
      invalidEvidenceFields,
    })

    expect(verifiedEvidence).toBeUndefined()
    expect(invalidEvidenceFields).toEqual([])
    expect(quality?.fieldStatus.age).toBe('unsupported')
    expect(quality?.invalidFields).toEqual([])
  })

  it('marks evidence invalid only when the source quote contradicts the extracted value', () => {
    const data = { age: 31 }
    const rawEvidence = { age: { quote: '30' } }
    const text = 'Alice is 30.'
    const invalidEvidenceFields = findInvalidFieldEvidence({
      schema,
      text,
      data,
      rawEvidence,
    })
    const quality = buildFieldEvidenceQuality({
      schema,
      data,
      rawEvidence,
      invalidEvidenceFields,
    })

    expect(invalidEvidenceFields).toEqual(['age'])
    expect(quality?.fieldStatus.age).toBe('invalid')
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

  it('should classify field evidence status without claiming unsupported fields are traceable', () => {
    const verifiedEvidence = verifyFieldEvidence({
      schema,
      text: 'Alice is 30',
      data: { name: 'Alice', age: 31, score: null },
      rawEvidence: {
        name: { quote: 'Alice' },
        age: { quote: '30' },
      },
    })

    const quality = buildFieldEvidenceQuality({
      schema,
      data: { name: 'Alice', age: 31, score: null },
      rawEvidence: {
        name: { quote: 'Alice' },
        age: { quote: '30' },
      },
      verifiedEvidence,
      invalidEvidenceFields: findInvalidFieldEvidence({
        schema,
        text: 'Alice is 30',
        data: { name: 'Alice', age: 31, score: null },
        rawEvidence: {
          name: { quote: 'Alice' },
          age: { quote: '30' },
        },
      }),
    })

    expect(quality).toEqual({
      fieldStatus: {
        name: 'supported',
        age: 'invalid',
        score: 'missing',
      },
      supportedFields: ['name'],
      unsupportedFields: [],
      missingFields: ['score'],
      invalidFields: ['age'],
      supportedRate: 1 / 3,
    })
  })

  it('marks populated scalar fields without evidence as unsupported', () => {
    const quality = buildFieldEvidenceQuality({
      schema,
      data: { name: 'Alice', age: 30, score: 95.5 },
    })

    expect(quality?.fieldStatus).toEqual({
      name: 'unsupported',
      age: 'unsupported',
      score: 'unsupported',
    })
    expect(quality?.unsupportedFields).toEqual(['name', 'age', 'score'])
  })

  it('keeps repeated score report values unsupported instead of invalid when they match the extracted data', () => {
    const scoreSchema: JsonSchemaDefinition = {
      title: 'ScoreReport',
      type: 'object',
      table: { name: 'score_report' },
      properties: {
        examYear: { type: 'integer' },
        province: { type: 'string' },
        chineseFull: { type: 'integer' },
        mathFull: { type: 'integer' },
        foreignLangFull: { type: 'integer' },
      },
    }
    const text = '考试年份：2017年 考试省份:湖北省 语文 106 150 71% 数学 78 150 52% 外语 80 150 53% 附:2017年湖北省 艺术(文)类'
    const data = {
      examYear: 2017,
      province: '湖北省',
      chineseFull: 150,
      mathFull: 150,
      foreignLangFull: 150,
    }
    const rawEvidence = {
      examYear: { quote: '2017' },
      province: { quote: '湖北省' },
      chineseFull: { quote: '150' },
      mathFull: { quote: '150' },
      foreignLangFull: { quote: '150' },
    }
    const verifiedEvidence = verifyFieldEvidence({
      schema: scoreSchema,
      text,
      data,
      rawEvidence,
    })
    const invalidEvidenceFields = findInvalidFieldEvidence({
      schema: scoreSchema,
      text,
      data,
      rawEvidence,
    })
    const quality = buildFieldEvidenceQuality({
      schema: scoreSchema,
      data,
      rawEvidence,
      verifiedEvidence,
      invalidEvidenceFields,
    })

    expect(verifiedEvidence).toBeUndefined()
    expect(invalidEvidenceFields).toEqual([])
    expect(quality?.invalidFields).toEqual([])
    expect(quality?.unsupportedFields).toEqual([
      'examYear',
      'province',
      'chineseFull',
      'mathFull',
      'foreignLangFull',
    ])
  })
})
