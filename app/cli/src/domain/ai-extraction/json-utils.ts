import { jsonrepair } from 'jsonrepair'

function parseJsonLike(text: string): unknown {
  const trimmed = text.trim()
  try {
    return JSON.parse(trimmed)
  }
  catch {
    if (!trimmed.startsWith('{') && !trimmed.startsWith('['))
      throw new SyntaxError('JSON candidate must start with an object or array')
    return JSON.parse(jsonrepair(trimmed))
  }
}

function stripFences(text: string): string | null {
  const trimmed = text.trim()
  if (!trimmed.startsWith('```'))
    return null

  const endIndex = trimmed.lastIndexOf('```')
  if (endIndex <= 3)
    return null

  const inside = trimmed.slice(3, endIndex)
  const firstNewline = inside.indexOf('\n')
  if (firstNewline === -1)
    return null

  return inside.slice(firstNewline + 1).trim()
}

function extractFirstJSON(text: string): string | null {
  const trimmed = text.trim()
  const firstBrace = trimmed.indexOf('{')
  const firstBracket = trimmed.indexOf('[')

  let start = -1
  if (firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) {
    start = firstBrace
  }
  else if (firstBracket !== -1) {
    start = firstBracket
  }

  if (start === -1)
    return null

  const end = start === firstBrace ? trimmed.lastIndexOf('}') + 1 : trimmed.lastIndexOf(']') + 1
  if (end <= start)
    return null

  return trimmed.slice(start, end)
}

export function safeParseJSON(text: string): unknown {
  const cleaned = text.trim()

  try {
    return JSON.parse(cleaned)
  }
  catch {
    // not clean JSON
  }

  const fromFence = stripFences(cleaned)
  if (fromFence) {
    try {
      return parseJsonLike(fromFence)
    }
    catch {
      // not valid JSON inside fences
    }
  }

  const extracted = extractFirstJSON(cleaned)
  if (extracted) {
    try {
      return parseJsonLike(extracted)
    }
    catch {
      // still not valid
    }
  }

  const truncated = text.length > 200 ? `${text.slice(0, 200)}...` : text
  throw new Error(
    `Failed to parse JSON from model output. `
    + `Expected a valid JSON object or array but received unparseable text. `
    + `Raw output: ${truncated}`,
  )
}
