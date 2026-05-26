interface MarkdownChunk {
  pageContent: string
  metadata: {
    h1?: string
    h2?: string
    h3?: string
    h4?: string
  }
}

const HEADING_RE = /^(#{1,6})\s+(\S.*)$/

/**
 * Splits a Markdown document into chunks based on header hierarchy.
 * Keeps tables and list blocks intact by splitting along paragraphs (\n\n)
 * when a section exceeds the maxSize limit.
 */
export function splitMarkdown(text: string, maxSize: number = 40000): MarkdownChunk[] {
  const lines = text.split('\n')
  const chunks: MarkdownChunk[] = []

  let currentHeadings: string[] = []
  let currentChunkLines: string[] = []
  let currentSize = 0

  const getMetadata = (headings: string[]): MarkdownChunk['metadata'] => {
    return {
      h1: headings[0] || undefined,
      h2: headings[1] || undefined,
      h3: headings[2] || undefined,
      h4: headings[3] || undefined,
    }
  }

  const flushChunk = (): void => {
    if (currentChunkLines.length === 0)
      return

    const pageContent = currentChunkLines.join('\n')
    // If this chunk alone is too large, we split it by paragraph boundaries
    if (pageContent.length > maxSize) {
      const paragraphs = pageContent.split('\n\n')
      let subLines: string[] = []
      let subSize = 0

      for (const para of paragraphs) {
        const paraSize = para.length
        if (subSize + paraSize > maxSize && subLines.length > 0) {
          chunks.push({
            pageContent: subLines.join('\n\n'),
            metadata: getMetadata(currentHeadings),
          })
          subLines = []
          subSize = 0
        }
        subLines.push(para)
        subSize += paraSize + 2
      }
      if (subLines.length > 0) {
        chunks.push({
          pageContent: subLines.join('\n\n'),
          metadata: getMetadata(currentHeadings),
        })
      }
    }
    else {
      chunks.push({
        pageContent,
        metadata: getMetadata(currentHeadings),
      })
    }

    currentChunkLines = []
    currentSize = 0
  }

  for (const line of lines) {
    const headingMatch = line.match(HEADING_RE)
    if (headingMatch) {
      // Flush accumulated content under the previous heading context
      flushChunk()

      const depth = headingMatch[1].length
      const title = headingMatch[2].trim()

      // Update active headings stack
      currentHeadings = currentHeadings.slice(0, depth - 1)
      currentHeadings[depth - 1] = title
    }

    currentChunkLines.push(line)
    currentSize += line.length + 1

    if (currentSize > maxSize) {
      flushChunk()
    }
  }

  flushChunk()
  return chunks
}
