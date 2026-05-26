import { getEncoding } from 'js-tiktoken'
import { marked } from 'marked'

export interface MarkdownChunk {
  pageContent: string
  metadata: {
    h1?: string
    h2?: string
    h3?: string
    h4?: string
  }
  chunkIndex?: number
  totalChunks?: number
  tokenCount?: number
  headingPath?: string[]
  charStart?: number
  charEnd?: number
}

const encoding = getEncoding('cl100k_base')
const MAX_OVERLAP_RATIO = 0.15
const MAX_EFFECTIVE_OVERLAP_TOKENS = 1200
const TABLE_SEPARATOR_CELL_RE = /^:?-{3,}:?$/
const LEADING_TABLE_PIPE_RE = /^\|/
const TRAILING_TABLE_PIPE_RE = /\|$/

export interface ChunkBudgetOptions {
  configuredMaxTokens?: number
  modelMaxTokens?: number
  outputReserveTokens?: number
  promptReserveTokens?: number
  safetyBufferTokens?: number
}

function countTokens(text: string): number {
  return encoding.encode(text).length
}

export function calculateChunkTokenBudget(options: ChunkBudgetOptions = {}): number {
  const configuredMaxTokens = options.configuredMaxTokens ?? 8000
  const modelMaxTokens = options.modelMaxTokens
  if (!modelMaxTokens) {
    return configuredMaxTokens
  }

  const outputReserveTokens = options.outputReserveTokens ?? 2000
  const promptReserveTokens = options.promptReserveTokens ?? 1200
  const safetyBufferTokens = options.safetyBufferTokens ?? Math.min(1000, Math.floor(modelMaxTokens * 0.1))
  const available = modelMaxTokens - outputReserveTokens - promptReserveTokens - safetyBufferTokens
  return Math.max(512, Math.min(configuredMaxTokens, available))
}

function formatHeadingContext(headings: string[]): string {
  const active = headings.filter(Boolean)
  if (active.length === 0)
    return ''
  return `> **[Context]** Belong to: ${active.join(' > ')}\n\n`
}

function getMetadata(headings: string[]): MarkdownChunk['metadata'] {
  return {
    h1: headings[0] || undefined,
    h2: headings[1] || undefined,
    h3: headings[2] || undefined,
    h4: headings[3] || undefined,
  }
}

function getHeadingPath(metadata: MarkdownChunk['metadata']): string[] {
  return [metadata.h1, metadata.h2, metadata.h3, metadata.h4].filter(Boolean) as string[]
}

function finalizeChunks(chunks: MarkdownChunk[], sourceText: string): MarkdownChunk[] {
  let searchStart = 0
  const totalChunks = chunks.length

  return chunks.map((chunk, index) => {
    const tokenCount = countTokens(chunk.pageContent)
    let charStart = sourceText.indexOf(chunk.pageContent, searchStart)
    if (charStart === -1) {
      charStart = sourceText.indexOf(chunk.pageContent)
    }
    const charEnd = charStart >= 0 ? charStart + chunk.pageContent.length : undefined
    if (charStart >= 0 && charEnd !== undefined) {
      searchStart = charEnd
    }

    return {
      ...chunk,
      chunkIndex: index,
      totalChunks,
      tokenCount,
      headingPath: getHeadingPath(chunk.metadata),
      charStart: charStart >= 0 ? charStart : undefined,
      charEnd,
    }
  })
}

function getEffectiveOverlapTokens(maxTokens: number, overlapTokens: number): number {
  return Math.floor(Math.min(overlapTokens, Math.max(64, maxTokens * MAX_OVERLAP_RATIO), MAX_EFFECTIVE_OVERLAP_TOKENS))
}

function splitMarkdownTable(tableText: string, maxTokens: number): string[] {
  if (countTokens(tableText) <= maxTokens) {
    return [tableText]
  }

  const lines = tableText.split('\n')
  const headerIndex = lines.findIndex(line => line.trim().startsWith('|'))
  const separatorIndex = lines.findIndex((line, index) => {
    if (index <= headerIndex)
      return false
    const cells = line.trim().replace(LEADING_TABLE_PIPE_RE, '').replace(TRAILING_TABLE_PIPE_RE, '').split('|').map(cell => cell.trim())
    return cells.length > 0 && cells.every(cell => TABLE_SEPARATOR_CELL_RE.test(cell))
  })
  if (headerIndex === -1 || separatorIndex === -1) {
    return splitTextRecursively(tableText, maxTokens, ['\n'])
  }

  const prefix = lines.slice(0, headerIndex)
  const header = lines[headerIndex]
  const separator = lines[separatorIndex]
  const rows = lines.slice(separatorIndex + 1).filter(line => line.trim() !== '')
  const chunks: string[] = []
  let currentRows: string[] = []

  const buildTable = (tableRows: string[]): string => {
    return [...prefix, header, separator, ...tableRows].join('\n')
  }

  for (const row of rows) {
    const candidateRows = [...currentRows, row]
    if (currentRows.length > 0 && countTokens(buildTable(candidateRows)) > maxTokens) {
      chunks.push(buildTable(currentRows))
      currentRows = [row]
    }
    else {
      currentRows = candidateRows
    }
  }

  if (currentRows.length > 0) {
    chunks.push(buildTable(currentRows))
  }

  return chunks.length > 0 ? chunks : [tableText]
}

/**
 * Splits text recursively using a list of separators.
 * Preserves the separators when re-joining.
 */
function splitTextRecursively(text: string, maxTokens: number, separators: string[] = ['\n\n', '\n', '。', '. ', ' ']): string[] {
  if (countTokens(text) <= maxTokens) {
    return [text]
  }

  if (separators.length === 0) {
    // Character-level hard fallback
    const chunks: string[] = []
    let current = ''
    for (const char of text) {
      if (countTokens(current + char) > maxTokens) {
        chunks.push(current)
        current = char
      }
      else {
        current += char
      }
    }
    if (current)
      chunks.push(current)
    return chunks
  }

  const separator = separators[0]
  const nextSeparators = separators.slice(1)
  const parts = text.split(separator)
  const result: string[] = []
  let currentChunk: string[] = []
  let currentChunkTokens = 0

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]
    // Re-attach the separator except for the last part
    const itemText = part + (i < parts.length - 1 ? separator : '')
    const partTokens = countTokens(itemText)

    if (partTokens > maxTokens) {
      // Flush current accumulated chunk
      if (currentChunk.length > 0) {
        result.push(currentChunk.join(''))
        currentChunk = []
        currentChunkTokens = 0
      }
      // Recursively split the part
      const subParts = splitTextRecursively(part, maxTokens, nextSeparators)
      for (let j = 0; j < subParts.length; j++) {
        const sub = subParts[j]
        const isLastSub = j === subParts.length - 1
        const finalSub = sub + (isLastSub && i < parts.length - 1 ? separator : '')
        result.push(finalSub)
      }
    }
    else {
      if (currentChunkTokens + partTokens > maxTokens) {
        result.push(currentChunk.join(''))
        currentChunk = [itemText]
        currentChunkTokens = partTokens
      }
      else {
        currentChunk.push(itemText)
        currentChunkTokens += partTokens
      }
    }
  }

  if (currentChunk.length > 0) {
    result.push(currentChunk.join(''))
  }

  return result
}

/**
 * Splits a Markdown document into chunks based on heading contexts, AST block parsing, and token limits.
 * Protects tables, list items, and code blocks from being broken.
 */
export function splitMarkdown(text: string, maxTokens: number = 8000, overlapTokens: number = 1000): MarkdownChunk[] {
  const tokens = marked.lexer(text)
  const chunks: MarkdownChunk[] = []
  const effectiveOverlapTokens = getEffectiveOverlapTokens(maxTokens, overlapTokens)

  let currentHeadings: string[] = []
  let currentChunkList: { text: string, headings: string[] }[] = []
  let accumulatedTokens = 0

  const flushCurrentChunk = (isHeadingChange = false): void => {
    if (currentChunkList.length === 0)
      return

    const pageContent = currentChunkList.map(item => item.text).join('')
    const firstHeadings = currentChunkList[0].headings

    chunks.push({
      pageContent,
      metadata: getMetadata(firstHeadings),
    })

    // Handle overlap
    if (isHeadingChange || effectiveOverlapTokens <= 0) {
      currentChunkList = []
      accumulatedTokens = 0
    }
    else {
      const overlapItems: typeof currentChunkList = []
      let currentOverlapTokens = 0
      for (let i = currentChunkList.length - 1; i >= 0; i--) {
        const item = currentChunkList[i]
        const itemTokens = countTokens(item.text)
        if (currentOverlapTokens + itemTokens > effectiveOverlapTokens && overlapItems.length > 0) {
          break
        }
        overlapItems.unshift(item)
        currentOverlapTokens += itemTokens
      }

      currentChunkList = [...overlapItems]
      accumulatedTokens = currentOverlapTokens
    }
  }

  for (const token of tokens) {
    if (token.type === 'space') {
      if (currentChunkList.length > 0) {
        currentChunkList[currentChunkList.length - 1].text += token.raw
        accumulatedTokens += countTokens(token.raw)
      }
      continue
    }

    if (token.type === 'heading') {
      // Flush any accumulated content under the previous heading before updating heading context
      flushCurrentChunk(true)

      const depth = token.depth
      const title = token.text.trim()
      currentHeadings = currentHeadings.slice(0, depth - 1)
      currentHeadings[depth - 1] = title
    }

    const rawText = token.raw

    // Expand giant lists to process list items individually
    if (token.type === 'list' && countTokens(rawText) > maxTokens) {
      for (const item of token.items) {
        processTextBlock(item.raw, currentHeadings)
      }
    }
    else {
      const isAtomic = token.type === 'table' || token.type === 'code'
      processTextBlock(rawText, currentHeadings, isAtomic)
    }
  }

  flushCurrentChunk(true)
  return finalizeChunks(chunks, text)

  function processTextBlock(blockText: string, headings: string[], isAtomic = false): void {
    const blockTokens = countTokens(blockText)
    const contextText = formatHeadingContext(headings)
    const contextTokens = countTokens(contextText)

    // Budget limit: maxTokens minus context size, with a small safety buffer of at most 10% or 10 tokens
    const safetyBuffer = Math.min(100, Math.max(2, Math.floor(maxTokens * 0.1)))
    const budgetLimit = Math.max(5, maxTokens - contextTokens - safetyBuffer)

    if (blockTokens > budgetLimit) {
      if (isAtomic) {
        flushCurrentChunk(false)
        const atomicBlocks = blockTokens <= maxTokens
          ? [blockText]
          : blockText.includes('|')
            ? splitMarkdownTable(blockText, budgetLimit)
            : splitTextRecursively(blockText, budgetLimit, ['\n'])
        for (const block of atomicBlocks) {
          currentChunkList.push({ text: block, headings: [...headings] })
          accumulatedTokens = countTokens(block)
          flushCurrentChunk(false)
        }
      }
      else {
        // Flush anything accumulated
        flushCurrentChunk(false)

        // Split the block text recursively using semantic dividers
        const subBlocks = splitTextRecursively(blockText, budgetLimit)
        for (const sub of subBlocks) {
          currentChunkList.push({ text: sub, headings: [...headings] })
          accumulatedTokens += countTokens(sub)
          if (accumulatedTokens > budgetLimit) {
            flushCurrentChunk(false)
          }
        }
      }
    }
    else {
      if (accumulatedTokens + blockTokens + contextTokens > maxTokens && currentChunkList.length > 0) {
        flushCurrentChunk(false)
      }
      currentChunkList.push({ text: blockText, headings: [...headings] })
      accumulatedTokens += blockTokens
    }
  }
}
