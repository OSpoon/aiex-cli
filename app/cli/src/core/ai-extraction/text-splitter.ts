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
export function splitMarkdown(text: string, maxSize: number = 40000, overlapSize: number = 0): MarkdownChunk[] {
  const lines = text.split('\n')
  const chunks: MarkdownChunk[] = []

  let currentHeadings: string[] = []
  let currentChunkLines: string[] = []
  let currentSize = 0
  let hasNewLines = false

  const getMetadata = (headings: string[]): MarkdownChunk['metadata'] => {
    return {
      h1: headings[0] || undefined,
      h2: headings[1] || undefined,
      h3: headings[2] || undefined,
      h4: headings[3] || undefined,
    }
  }

  const flushChunk = (isHeadingChange: boolean = false): void => {
    if (currentChunkLines.length === 0 || !hasNewLines) {
      currentChunkLines = []
      currentSize = 0
      hasNewLines = false
      return
    }

    const pageContent = currentChunkLines.join('\n')
    let lastChunkContent = ''

    // If this chunk alone is too large, we split it by paragraph boundaries
    if (pageContent.length > maxSize) {
      const paragraphs = pageContent.split('\n\n')
      let subLines: string[] = []
      let subSize = 0

      for (const para of paragraphs) {
        const paraSize = para.length
        if (subSize + paraSize > maxSize && subLines.length > 0) {
          const content = subLines.join('\n\n')
          chunks.push({
            pageContent: content,
            metadata: getMetadata(currentHeadings),
          })

          // Calculate overlap: keep trailing paragraphs that fit within overlapSize
          const overlapParas: string[] = []
          let currentOverlapSize = 0
          for (let j = subLines.length - 1; j >= 0; j--) {
            const p = subLines[j]
            if (currentOverlapSize + p.length > overlapSize && overlapParas.length > 0) {
              break
            }
            overlapParas.unshift(p)
            currentOverlapSize += p.length + 2
          }
          subLines = [...overlapParas]
          subSize = currentOverlapSize
        }
        subLines.push(para)
        subSize += paraSize + 2
      }
      if (subLines.length > 0) {
        const content = subLines.join('\n\n')
        chunks.push({
          pageContent: content,
          metadata: getMetadata(currentHeadings),
        })
        lastChunkContent = content
      }
    }
    else {
      chunks.push({
        pageContent,
        metadata: getMetadata(currentHeadings),
      })
      lastChunkContent = pageContent
    }

    // Carry over overlap to the next chunk
    if (!isHeadingChange && lastChunkContent && overlapSize > 0) {
      const paragraphs = lastChunkContent.split('\n\n')
      const overlapParas: string[] = []
      let currentOverlapSize = 0
      for (let j = paragraphs.length - 1; j >= 0; j--) {
        const p = paragraphs[j]
        if (currentOverlapSize + p.length > overlapSize && overlapParas.length > 0) {
          break
        }
        overlapParas.unshift(p)
        currentOverlapSize += p.length + 2
      }
      const overlapText = overlapParas.join('\n\n')
      currentChunkLines = overlapText.split('\n')
      currentSize = overlapText.length
    }
    else {
      currentChunkLines = []
      currentSize = 0
    }
    hasNewLines = false
  }

  for (const line of lines) {
    const headingMatch = line.match(HEADING_RE)
    if (headingMatch) {
      // Flush accumulated content under the previous heading context
      flushChunk(true)

      const depth = headingMatch[1].length
      const title = headingMatch[2].trim()

      // Update active headings stack
      currentHeadings = currentHeadings.slice(0, depth - 1)
      currentHeadings[depth - 1] = title
    }

    currentChunkLines.push(line)
    currentSize += line.length + 1
    hasNewLines = true

    if (currentSize > maxSize) {
      flushChunk(false)
    }
  }

  flushChunk(true)
  return chunks
}
