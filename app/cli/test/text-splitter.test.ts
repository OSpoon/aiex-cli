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

  it('performs sub-splitting at paragraph boundaries if section exceeds maxTokens', () => {
    const text = `# Large Section
Paragraph 1 content that is long.

Paragraph 2 content that is also long.

Paragraph 3 content.
`
    const chunks = splitMarkdown(text, 30)

    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.every(c => c.metadata.h1 === 'Large Section')).toBe(true)
    expect(chunks[0].pageContent).toContain('Paragraph 1')
  })

  it('preserves Markdown tables and does not split them internally', () => {
    const text = `# Section with Table
Here is some text before table.

| Header 1 | Header 2 |
| --- | --- |
| Row 1 Col 1 | Row 1 Col 2 |
| Row 2 Col 1 | Row 2 Col 2 |

Some other trailing text.
`
    // The table block is about 30 tokens. Set budget to 60.
    const chunks = splitMarkdown(text, 60)

    // Verify that one of the chunks contains the complete table intact
    const tableChunk = chunks.find(c => c.pageContent.includes('| Header 1 |'))
    expect(tableChunk).toBeDefined()
    expect(tableChunk!.pageContent).toContain('Row 2 Col 2')
  })

  it('performs recursive semantic sub-splitting on huge paragraphs', () => {
    const text = `This is a very long paragraph. It has multiple sentences. We want to test that it splits nicely at sentence boundaries. That means at the Chinese or English period character.`
    const chunks = splitMarkdown(text, 12)
    expect(chunks.length).toBeGreaterThan(1)
    // The first chunk should end with a period
    expect(chunks[0].pageContent.trim()).toMatch(/[.。]$/)
  })

  it('supports overlapTokens to carry over trailing paragraphs to the next chunk', () => {
    const text = `This is the first paragraph. It is designed to be around twelve tokens long.

This is the second paragraph. It is also designed to be around twelve tokens long.

This is the third paragraph. It is also designed to be around twelve tokens long.
`
    const chunks = splitMarkdown(text, 20, 15)

    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks[0].pageContent).toContain('first')
    expect(chunks[1].pageContent).toContain('first')
    expect(chunks[1].pageContent).toContain('second')
  })
})
