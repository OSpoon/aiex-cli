import type { MarkdownChunk } from './text-splitter'
import type { JsonSchemaDefinition, JsonSchemaProperty } from '@/core/schema-sqlite/schemas'
import type { EvidenceSummary } from '@/types'
import path from 'node:path'
import { writeFile as writeJsonFile } from 'jsonfile'

const JSON_FILE_SUFFIX_RE = /\.json$/i
const FIELD_PATH_PREFIX_RE = /^\$\./

export type FieldEvidenceStatus = 'found' | 'missing' | 'inferred'

export interface FieldEvidence {
  fieldPath: string
  status: FieldEvidenceStatus
  value?: unknown
  chunkIndex?: number
  headingPath?: string[]
  quote?: string
  confidence: number
  note?: string
}

export interface ExtractionEvidenceReport {
  coverage: EvidenceSummary
  fields: FieldEvidence[]
  candidates?: FieldCandidate[]
  conflicts?: FieldConflict[]
  issues: Array<{ fieldPath: string, message: string }>
}

export interface FieldCandidate {
  fieldPath: string
  value: unknown
  chunkIndex: number
  headingPath?: string[]
  status: 'found' | 'inferred'
  quote?: string
  confidence: number
  selected?: boolean
  rejectionReason?: string
}

export interface FieldConflict {
  fieldPath: string
  selectedValue: unknown
  rejectedValues: unknown[]
  candidates: FieldCandidate[]
}

export interface CandidateMergeReport {
  candidates: FieldCandidate[]
  conflicts: FieldConflict[]
}

interface SourceChunk {
  text: string
  chunkIndex?: number
  headingPath?: string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stableValueKey(value: unknown): string {
  return JSON.stringify(value)
}

function isPlaceholderString(value: unknown): boolean {
  if (typeof value !== 'string')
    return false

  const normalized = value.trim().toLowerCase()
  return normalized === ''
    || normalized === 'n/a'
    || normalized === 'na'
    || normalized === 'none'
    || normalized === 'null'
    || normalized === 'unknown'
    || normalized === 'tbd'
    || normalized === '-'
    || normalized === '--'
}

function primitiveToText(value: unknown): string | null {
  if (value === null || value === undefined)
    return null
  if (typeof value === 'string')
    return value.trim() || null
  if (typeof value === 'number' || typeof value === 'boolean')
    return String(value)
  return null
}

function isMeaningfulValue(value: unknown): boolean {
  return primitiveToText(value) !== null && !isPlaceholderString(value)
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim()
}

function quoteAround(text: string, start: number, length: number): string {
  const before = Math.max(0, start - 80)
  const after = Math.min(text.length, start + length + 80)
  return text.slice(before, after).replace(/\s+/g, ' ').trim()
}

function findEvidence(value: unknown, chunks: SourceChunk[]): Omit<FieldEvidence, 'fieldPath' | 'status' | 'value' | 'confidence'> | null {
  const searchText = primitiveToText(value)
  if (!searchText)
    return null

  const normalizedSearchText = normalizeText(searchText)
  if (!normalizedSearchText)
    return null

  for (const chunk of chunks) {
    const normalizedChunk = normalizeText(chunk.text)
    const normalizedIndex = normalizedChunk.indexOf(normalizedSearchText)
    if (normalizedIndex === -1)
      continue

    const rawIndex = chunk.text.toLowerCase().indexOf(searchText.toLowerCase())
    const quoteIndex = rawIndex >= 0 ? rawIndex : 0
    return {
      chunkIndex: chunk.chunkIndex,
      headingPath: chunk.headingPath,
      quote: quoteAround(chunk.text, quoteIndex, searchText.length),
    }
  }

  return null
}

function addEvidenceForProperty(
  fields: FieldEvidence[],
  path: string,
  property: JsonSchemaProperty,
  value: unknown,
  chunks: SourceChunk[],
): void {
  if (property.type === 'object' && property.properties) {
    const record = isRecord(value) ? value : {}
    for (const [childName, childProperty] of Object.entries(property.properties)) {
      addEvidenceForProperty(fields, `${path}.${childName}`, childProperty, record[childName], chunks)
    }
    return
  }

  if (property.type === 'array') {
    if (!Array.isArray(value) || value.length === 0) {
      fields.push({
        fieldPath: path,
        status: 'missing',
        value: null,
        confidence: 0,
        note: 'Array field is empty or missing.',
      })
      return
    }

    value.forEach((item, index) => {
      if (property.items?.type === 'object' && property.items.properties) {
        const record = isRecord(item) ? item : {}
        for (const [childName, childProperty] of Object.entries(property.items.properties)) {
          addEvidenceForProperty(fields, `${path}[${index}].${childName}`, childProperty, record[childName], chunks)
        }
      }
      else {
        addPrimitiveEvidence(fields, `${path}[${index}]`, item, chunks)
      }
    })
    return
  }

  addPrimitiveEvidence(fields, path, value, chunks)
}

function addPrimitiveEvidence(fields: FieldEvidence[], fieldPath: string, value: unknown, chunks: SourceChunk[]): void {
  if (value === null || value === undefined || value === '') {
    fields.push({
      fieldPath,
      status: 'missing',
      value: null,
      confidence: 0,
      note: 'Field is null or empty in final extraction.',
    })
    return
  }

  const found = findEvidence(value, chunks)
  if (found) {
    fields.push({
      fieldPath,
      status: 'found',
      value,
      confidence: 0.8,
      ...found,
    })
    return
  }

  fields.push({
    fieldPath,
    status: 'inferred',
    value,
    confidence: 0.35,
    note: 'Final value was not found verbatim in the available source text.',
  })
}

function sourceChunksFromText(text: string): SourceChunk[] {
  return text ? [{ text, chunkIndex: 0, headingPath: [] }] : []
}

function sourceChunksFromMarkdownChunks(chunks: MarkdownChunk[]): SourceChunk[] {
  return chunks.map((chunk, index) => ({
    text: chunk.pageContent,
    chunkIndex: chunk.chunkIndex ?? index,
    headingPath: chunk.headingPath ?? [],
  }))
}

function getPathParts(fieldPath: string): string[] {
  return fieldPath.replace(FIELD_PATH_PREFIX_RE, '').split('.').filter(Boolean)
}

function getValueAtPath(data: unknown, fieldPath: string): unknown {
  let current = data
  for (const part of getPathParts(fieldPath)) {
    if (!isRecord(current))
      return undefined
    current = current[part]
  }
  return current
}

function setValueAtPath(data: Record<string, unknown>, fieldPath: string, value: unknown): void {
  const parts = getPathParts(fieldPath)
  let current: Record<string, unknown> = data
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]
    if (!isRecord(current[part])) {
      current[part] = {}
    }
    current = current[part] as Record<string, unknown>
  }
  current[parts[parts.length - 1]] = value
}

function collectScalarFields(
  fields: Array<{ fieldPath: string, property: JsonSchemaProperty }>,
  fieldPath: string,
  property: JsonSchemaProperty,
): void {
  if (property.type === 'object' && property.properties) {
    for (const [name, childProperty] of Object.entries(property.properties)) {
      collectScalarFields(fields, `${fieldPath}.${name}`, childProperty)
    }
    return
  }

  if (property.type !== 'array') {
    fields.push({ fieldPath, property })
  }
}

function candidateScore(candidate: FieldCandidate): number {
  const evidenceScore = candidate.status === 'found' ? 100 : 0
  const confidenceScore = Math.round(candidate.confidence * 10)
  return evidenceScore + confidenceScore + candidate.chunkIndex
}

function selectCandidatesForField(candidates: FieldCandidate[]): FieldConflict | null {
  if (candidates.length === 0)
    return null

  candidates.sort((a, b) => candidateScore(b) - candidateScore(a))
  const selected = candidates[0]
  selected.selected = true
  for (const candidate of candidates.slice(1)) {
    candidate.selected = false
    candidate.rejectionReason = 'Lower evidence score or earlier chunk position.'
  }

  const distinctValues = new Map<string, unknown>()
  for (const candidate of candidates) {
    distinctValues.set(stableValueKey(candidate.value), candidate.value)
  }

  if (distinctValues.size <= 1)
    return null

  return {
    fieldPath: selected.fieldPath,
    selectedValue: selected.value,
    rejectedValues: candidates.slice(1).map(candidate => candidate.value),
    candidates: [...candidates],
  }
}

export function buildCandidateMergeReport(input: {
  schema: JsonSchemaDefinition
  chunkResults: Record<string, unknown>[]
  chunks: MarkdownChunk[]
}): CandidateMergeReport {
  const scalarFields: Array<{ fieldPath: string, property: JsonSchemaProperty }> = []
  for (const [name, property] of Object.entries(input.schema.properties)) {
    if (property.primary && property.autoIncrement)
      continue
    collectScalarFields(scalarFields, `$.${name}`, property)
  }

  const sourceChunks = sourceChunksFromMarkdownChunks(input.chunks)
  const candidatesByPath = new Map<string, FieldCandidate[]>()

  for (const { fieldPath } of scalarFields) {
    for (let chunkIndex = 0; chunkIndex < input.chunkResults.length; chunkIndex++) {
      const value = getValueAtPath(input.chunkResults[chunkIndex], fieldPath)
      if (!isMeaningfulValue(value))
        continue

      const sourceChunk = sourceChunks[chunkIndex] ?? { text: '', chunkIndex }
      const found = findEvidence(value, [sourceChunk])
      const candidate: FieldCandidate = {
        fieldPath,
        value,
        chunkIndex: sourceChunk.chunkIndex ?? chunkIndex,
        headingPath: sourceChunk.headingPath,
        status: found ? 'found' : 'inferred',
        quote: found?.quote,
        confidence: found ? 0.85 : 0.35,
      }
      const candidates = candidatesByPath.get(fieldPath) ?? []
      candidates.push(candidate)
      candidatesByPath.set(fieldPath, candidates)
    }
  }

  const allCandidates: FieldCandidate[] = []
  const conflicts: FieldConflict[] = []
  for (const candidates of candidatesByPath.values()) {
    const conflict = selectCandidatesForField(candidates)
    allCandidates.push(...candidates)
    if (conflict)
      conflicts.push(conflict)
  }

  return { candidates: allCandidates, conflicts }
}

export function applySelectedCandidates(data: Record<string, unknown>, report: CandidateMergeReport): Record<string, unknown> {
  const merged = structuredClone(data)
  for (const candidate of report.candidates) {
    if (candidate.selected) {
      setValueAtPath(merged, candidate.fieldPath, candidate.value)
    }
  }
  return merged
}

export function buildExtractionEvidence(input: {
  schema: JsonSchemaDefinition
  data: unknown
  text?: string
  chunks?: MarkdownChunk[]
  outputPath?: string
  candidateReport?: CandidateMergeReport
}): ExtractionEvidenceReport {
  const data = isRecord(input.data) ? input.data : {}
  const chunks = input.chunks ? sourceChunksFromMarkdownChunks(input.chunks) : sourceChunksFromText(input.text ?? '')
  const fields: FieldEvidence[] = []

  for (const [name, property] of Object.entries(input.schema.properties)) {
    if (property.primary && property.autoIncrement)
      continue
    addEvidenceForProperty(fields, `$.${name}`, property, data[name], chunks)
  }

  const inferredIssues = fields
    .filter(field => field.status === 'inferred')
    .map(field => ({ fieldPath: field.fieldPath, message: field.note ?? 'Field value lacks source evidence.' }))
  const conflictIssues = (input.candidateReport?.conflicts ?? [])
    .map(conflict => ({ fieldPath: conflict.fieldPath, message: 'Multiple chunk candidates disagree for this field.' }))
  const issues = [...inferredIssues, ...conflictIssues]

  const coverage: EvidenceSummary = {
    path: input.outputPath ? evidencePathForOutput(input.outputPath) : undefined,
    fieldCount: fields.length,
    evidenceCount: fields.filter(field => field.status === 'found').length,
    foundCount: fields.filter(field => field.status === 'found').length,
    missingCount: fields.filter(field => field.status === 'missing').length,
    inferredCount: fields.filter(field => field.status === 'inferred').length,
    conflictCount: input.candidateReport?.conflicts.length ?? 0,
    issueCount: issues.length,
  }

  return {
    coverage,
    fields,
    candidates: input.candidateReport?.candidates,
    conflicts: input.candidateReport?.conflicts,
    issues,
  }
}

export function evidencePathForOutput(outputPath: string): string {
  return outputPath.replace(JSON_FILE_SUFFIX_RE, '.evidence.json')
}

export async function writeExtractionEvidence(input: {
  schema: JsonSchemaDefinition
  data: unknown
  outputPath: string
  text?: string
  chunks?: MarkdownChunk[]
  candidateReport?: CandidateMergeReport
}): Promise<EvidenceSummary> {
  const report = buildExtractionEvidence(input)
  const evidencePath = evidencePathForOutput(input.outputPath)
  report.coverage.path = evidencePath
  await writeJsonFile(evidencePath, report, { spaces: 2, EOL: '\n' })
  return { ...report.coverage, path: path.resolve(evidencePath) }
}
