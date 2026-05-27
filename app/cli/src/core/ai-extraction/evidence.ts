import type { JsonSchemaDefinition, JsonSchemaProperty } from '@/core/schema-sqlite/schemas'

export interface RawFieldEvidence {
  quote?: unknown
}

export interface VerifiedFieldEvidence {
  quote: string
  start: number
  end: number
  verified: true
  matchMethod: 'exact_unique'
}

export type VerifiedEvidenceMap = Record<string, VerifiedFieldEvidence>

export interface StripEvidenceResult {
  data: unknown
  rawEvidence?: Record<string, RawFieldEvidence>
}

const NUMERIC_RE = /^-?\d+(?:\.\d+)?$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function stripEvidence(data: unknown): StripEvidenceResult {
  if (!isRecord(data))
    return { data }

  const { _evidence, ...businessData } = data
  if (!isRecord(_evidence))
    return { data: businessData }

  const rawEvidence = Object.fromEntries(
    Object.entries(_evidence)
      .filter(([, value]) => isRecord(value))
      .map(([field, value]) => [field, value as RawFieldEvidence]),
  )

  return {
    data: businessData,
    rawEvidence,
  }
}

function findExactUnique(text: string, quote: string): { start: number, end: number } | null {
  const start = text.indexOf(quote)
  if (start < 0)
    return null
  if (text.includes(quote, start + quote.length))
    return null
  return { start, end: start + quote.length }
}

function normalizeString(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase()
}

function normalizeNumber(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value))
    return String(value)
  if (typeof value !== 'string')
    return null
  const normalized = value.replace(/,/g, '').trim()
  return NUMERIC_RE.test(normalized) ? normalized : null
}

function quoteContainsValue(quote: string, value: unknown, property: JsonSchemaProperty): boolean {
  if (value === null || value === undefined)
    return false

  if (property.type === 'string')
    return normalizeString(quote).includes(normalizeString(String(value)))

  if (property.type === 'number' || property.type === 'integer') {
    const normalizedValue = normalizeNumber(value)
    if (!normalizedValue)
      return false
    const normalizedQuote = quote.replace(/,/g, '')
    return normalizedQuote.includes(normalizedValue)
  }

  return false
}

export function verifyFieldEvidence(input: {
  schema: JsonSchemaDefinition
  text: string
  data: unknown
  rawEvidence?: Record<string, RawFieldEvidence>
}): VerifiedEvidenceMap | undefined {
  if (!input.text || !isRecord(input.data) || !input.rawEvidence)
    return undefined

  const verified: VerifiedEvidenceMap = {}

  for (const [field, raw] of Object.entries(input.rawEvidence)) {
    const property = input.schema.properties[field]
    if (!property)
      continue
    if (property.type !== 'string' && property.type !== 'number' && property.type !== 'integer')
      continue
    if (typeof raw.quote !== 'string' || raw.quote.trim().length === 0)
      continue
    if (!quoteContainsValue(raw.quote, input.data[field], property))
      continue

    const match = findExactUnique(input.text, raw.quote)
    if (!match)
      continue

    verified[field] = {
      quote: raw.quote,
      start: match.start,
      end: match.end,
      verified: true,
      matchMethod: 'exact_unique',
    }
  }

  return Object.keys(verified).length > 0 ? verified : undefined
}
