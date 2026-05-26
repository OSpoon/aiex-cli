import { describe, expect, it } from 'vitest'
import { mergeExtractionResults } from '../src/core/ai-extraction/json-merger'
import { annotatedSchema, flatSchema, nestedSchema } from './ai-extraction.test-utils'

describe('mergeExtractionResults', () => {
  it('returns empty object when results are empty', () => {
    const result = mergeExtractionResults(flatSchema, [])
    expect(result).toEqual({})
  })

  it('returns the single item when results have length 1', () => {
    const data = { name: 'Alice', age: 30 }
    const result = mergeExtractionResults(flatSchema, [data])
    expect(result).toEqual(data)
  })

  it('merges flat schema properties correctly', () => {
    const results = [
      { name: 'Alice', age: null },
      { name: '', age: 30 },
      { name: 'Bob', age: 25 },
    ]
    const merged = mergeExtractionResults(flatSchema, results)
    // We expect:
    // name: 'Alice' (takes first non-empty string)
    // age: 30 (takes first non-null number)
    expect(merged).toEqual({
      name: 'Alice',
      age: 30,
    })
  })

  it('merges nested schema properties recursively', () => {
    const results = [
      {
        name: 'Acme Corp',
        address: { street: '123 Main St', city: '' },
        orders: [
          { product: 'Widget A', amount: 100 },
        ],
      },
      {
        name: null,
        address: { street: null, city: 'New York' },
        orders: [
          { product: 'Widget B', amount: 200 },
        ],
      },
      {
        name: 'Acme LLC',
        address: null,
        orders: [],
      },
    ]

    const merged = mergeExtractionResults(nestedSchema, results)

    expect(merged).toEqual({
      name: 'Acme Corp',
      address: {
        street: '123 Main St',
        city: 'New York',
      },
      orders: [
        { product: 'Widget A', amount: 100 },
        { product: 'Widget B', amount: 200 },
      ],
    })
  })

  it('handles annotated schemas with metadata objects and arrays', () => {
    const results = [
      {
        email: 'alice@example.com',
        bio: 'Hello world',
        score: null,
        tags: ['tech'],
        metadata: { key: 'val1' },
      },
      {
        email: '',
        bio: 'Another bio description',
        score: 95,
        tags: ['news', 'finance'],
        metadata: null,
      },
    ]

    const merged = mergeExtractionResults(annotatedSchema, results)

    expect(merged).toEqual({
      email: 'alice@example.com',
      bio: 'Hello world',
      score: 95,
      tags: ['tech', 'news', 'finance'],
      metadata: {
        key: 'val1',
      },
    })
  })
})
