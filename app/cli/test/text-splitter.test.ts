import { describe, expect, it } from 'vitest'
import { splitMarkdown } from '../src/core/ai-extraction/text-splitter'

describe('splitMarkdown', () => {
  it('splits markdown text by headings and associates metadata', () => {
    const text = `# Chapter 1
Some introductory text.

## Section 1.1
Content under 1.1.

### Subsection 1.1.1
Detail 1.1.1.

## Section 1.2
Content under 1.2.
`
    const chunks = splitMarkdown(text, 1000)

    expect(chunks).toHaveLength(4)
    expect(chunks[0].pageContent.trim()).toBe(`# Chapter 1\nSome introductory text.`)
    expect(chunks[0].metadata).toEqual({ h1: 'Chapter 1', h2: undefined, h3: undefined, h4: undefined })

    expect(chunks[1].pageContent.trim()).toBe(`## Section 1.1\nContent under 1.1.`)
    expect(chunks[1].metadata).toEqual({ h1: 'Chapter 1', h2: 'Section 1.1', h3: undefined, h4: undefined })

    expect(chunks[2].pageContent.trim()).toBe(`### Subsection 1.1.1\nDetail 1.1.1.`)
    expect(chunks[2].metadata).toEqual({ h1: 'Chapter 1', h2: 'Section 1.1', h3: 'Subsection 1.1.1', h4: undefined })

    expect(chunks[3].pageContent.trim()).toBe(`## Section 1.2\nContent under 1.2.`)
    expect(chunks[3].metadata).toEqual({ h1: 'Chapter 1', h2: 'Section 1.2', h3: undefined, h4: undefined })
  })

  it('performs sub-splitting at paragraph boundaries if section exceeds maxSize', () => {
    const text = `# Large Section
Paragraph 1 content that is long.

Paragraph 2 content that is also long.

Paragraph 3 content.
`
    // Force a very small maxSize to trigger sub-splitting
    const chunks = splitMarkdown(text, 50)

    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.every(c => c.metadata.h1 === 'Large Section')).toBe(true)
    expect(chunks[0].pageContent).toContain('Paragraph 1')
    expect(chunks[1].pageContent).toContain('Paragraph 2')
  })
})
