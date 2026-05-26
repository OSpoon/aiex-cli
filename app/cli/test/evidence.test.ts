import { describe, expect, it } from 'vitest'
import { applySelectedCandidates, buildCandidateMergeReport, buildExtractionEvidence } from '@/core/ai-extraction/evidence'
import { flatSchema, nestedSchema } from './ai-extraction.test-utils'

describe('buildExtractionEvidence', () => {
  it('marks primitive fields as found when values appear in source text', () => {
    const report = buildExtractionEvidence({
      schema: flatSchema,
      data: { name: 'Alice', age: 30 },
      text: 'Customer Alice is 30 years old.',
      outputPath: '/tmp/person.json',
    })

    expect(report.coverage).toMatchObject({
      fieldCount: 2,
      evidenceCount: 2,
      foundCount: 2,
      missingCount: 0,
      inferredCount: 0,
      issueCount: 0,
    })
    expect(report.fields.find(field => field.fieldPath === '$.name')).toMatchObject({
      status: 'found',
      quote: expect.stringContaining('Alice'),
    })
  })

  it('marks null values as missing and unmatched values as inferred', () => {
    const report = buildExtractionEvidence({
      schema: flatSchema,
      data: { name: 'Alice', age: null },
      text: 'The source mentions Bob only.',
    })

    expect(report.fields.find(field => field.fieldPath === '$.name')).toMatchObject({
      status: 'inferred',
    })
    expect(report.fields.find(field => field.fieldPath === '$.age')).toMatchObject({
      status: 'missing',
    })
    expect(report.coverage.issueCount).toBe(1)
  })

  it('creates evidence paths for nested array item fields', () => {
    const report = buildExtractionEvidence({
      schema: nestedSchema,
      data: {
        name: 'Acme',
        address: { street: '1 Main St', city: 'Paris' },
        orders: [{ product: 'Widget', amount: 42 }],
      },
      chunks: [
        {
          pageContent: 'Acme address: 1 Main St, Paris. Order product Widget amount 42.',
          metadata: { h1: 'Contract' },
          chunkIndex: 3,
          headingPath: ['Contract'],
        },
      ],
    })

    expect(report.fields.find(field => field.fieldPath === '$.orders[0].product')).toMatchObject({
      status: 'found',
      chunkIndex: 3,
      headingPath: ['Contract'],
    })
  })

  it('selects later evidenced scalar candidates and reports conflicts', () => {
    const candidateReport = buildCandidateMergeReport({
      schema: flatSchema,
      chunkResults: [
        { name: 'Draft Co', age: 28 },
        { name: 'Final Co', age: 28 },
      ],
      chunks: [
        {
          pageContent: 'Draft name: Draft Co. Age 28.',
          metadata: { h1: 'Draft' },
          chunkIndex: 0,
          headingPath: ['Draft'],
        },
        {
          pageContent: 'Final legal name: Final Co. Age 28.',
          metadata: { h1: 'Final' },
          chunkIndex: 1,
          headingPath: ['Final'],
        },
      ],
    })

    const merged = applySelectedCandidates({ name: 'Draft Co', age: 28 }, candidateReport)
    const report = buildExtractionEvidence({
      schema: flatSchema,
      data: merged,
      chunks: [
        {
          pageContent: 'Draft name: Draft Co. Age 28.',
          metadata: { h1: 'Draft' },
          chunkIndex: 0,
          headingPath: ['Draft'],
        },
        {
          pageContent: 'Final legal name: Final Co. Age 28.',
          metadata: { h1: 'Final' },
          chunkIndex: 1,
          headingPath: ['Final'],
        },
      ],
      candidateReport,
    })

    expect(merged.name).toBe('Final Co')
    expect(candidateReport.conflicts).toHaveLength(1)
    expect(candidateReport.conflicts[0]).toMatchObject({
      fieldPath: '$.name',
      selectedValue: 'Final Co',
    })
    expect(report.coverage.conflictCount).toBe(1)
    expect(report.issues.some(issue => issue.fieldPath === '$.name')).toBe(true)
  })
})
