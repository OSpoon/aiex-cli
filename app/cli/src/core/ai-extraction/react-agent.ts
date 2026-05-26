import type { AIConfig, AIModelConfig, ExtractionResult, JsonSchemaDefinition, SelectedModel } from '@/types'
import type { RetryInfo } from '@/utils/retry'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { generateText, hasToolCall, isLoopFinished, stepCountIs, tool, ToolLoopAgent } from 'ai'
import { writeFile as writeJsonFile } from 'jsonfile'
import { z } from 'zod'
import { getErrorMessage } from '@/core/schema-sqlite'
import { t } from '@/locales'
import { withRetry } from '@/utils/retry'
import { safeParseJSON } from './json-utils'
import { selectModel } from './model-selector'
import { initLangfuse } from './telemetry'
import { splitMarkdown } from './text-splitter'
import { schemaToExtractionOutputSchema, validateExtractedData } from './validator'

const AGENT_CHUNK_SIZE = 15000
const DEFAULT_SEARCH_LIMIT = 10
const MAX_SEARCH_LIMIT = 20
const MAX_RANGE_LENGTH = 8000
const MAX_CORRECTION_ATTEMPTS = 3
const JSON_PATH_PREFIX_RE = /^\$\./
const JSON_PATH_ARRAY_MARKER_RE = /\[\]/g

interface AgentTraceEntry {
  type: 'tool' | 'step' | 'correction' | 'prepare-step' | 'tool-repair' | 'finish' | 'retrieval-plan' | 'evidence-coverage'
  name?: string
  input?: unknown
  output?: unknown
  thought?: string
  toolCalls?: unknown[]
  error?: string
}

interface FieldEvidence {
  fieldPath: string
  status: 'found' | 'missing' | 'inferred'
  chunkId?: number
  headingPath?: string
  snippet?: string
  confidence?: number
  note?: string
}

interface RetrievalPlanField {
  path: string
  name: string
  type?: string
  required: boolean
  queries: string[]
}

interface EvidenceCoverageIssue {
  fieldPath: string
  severity: 'warning' | 'error'
  message: string
}

function headingPath(metadata: Record<string, unknown> | undefined): string {
  if (!metadata)
    return ''
  return ['h1', 'h2', 'h3', 'h4', 'h5', 'h6']
    .map(key => metadata[key])
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .join(' > ')
}

function normalizeText(value: string): string {
  return value.toLowerCase().normalize('NFKC')
}

function tokenize(value: string): string[] {
  return Array.from(new Set(normalizeText(value).match(/[\p{L}\p{N}_-]+/gu) ?? []))
    .filter(token => token.length > 1)
}

function splitIdentifier(value: string): string[] {
  return Array.from(new Set(
    value
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .split(/[\s._:/\\-]+/g)
      .flatMap(part => tokenize(part)),
  ))
}

function makeSnippet(text: string, index: number, length: number, radius = 90): string {
  const safeIndex = Math.max(0, index)
  const start = Math.max(0, safeIndex - radius)
  const end = Math.min(text.length, safeIndex + Math.max(length, 1) + radius)
  return `...${text.slice(start, end).replace(/\s+/g, ' ').trim()}...`
}

function primitiveToSearchText(value: unknown): string | null {
  if (value === null || value === undefined)
    return null
  if (typeof value === 'string')
    return value.trim() || null
  if (typeof value === 'number' || typeof value === 'boolean')
    return String(value)
  return null
}

function flattenPrimitiveValues(value: unknown, prefix = '$'): Array<{ path: string, value: unknown }> {
  if (value === null || value === undefined || ['string', 'number', 'boolean'].includes(typeof value)) {
    return [{ path: prefix, value }]
  }

  if (Array.isArray(value)) {
    return value.flatMap((item, index) => flattenPrimitiveValues(item, `${prefix}[${index}]`))
  }

  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .flatMap(([key, child]) => flattenPrimitiveValues(child, `${prefix}.${key}`))
  }

  return []
}

function normalizeEvidenceMap(evidence: unknown): FieldEvidence[] {
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence))
    return []

  return Object.entries(evidence as Record<string, any>)
    .map(([fieldPath, value]) => ({
      fieldPath,
      status: value?.status === 'missing' || value?.status === 'inferred' ? value.status : 'found',
      chunkId: Number.isInteger(value?.chunkId) ? value.chunkId : undefined,
      headingPath: typeof value?.headingPath === 'string' ? value.headingPath : undefined,
      snippet: typeof value?.snippet === 'string' ? value.snippet : undefined,
      confidence: typeof value?.confidence === 'number' ? value.confidence : undefined,
      note: typeof value?.note === 'string' ? value.note : undefined,
    }))
}

function buildRetrievalPlan(schema: JsonSchemaDefinition): RetrievalPlanField[] {
  const fields: RetrievalPlanField[] = []

  function walk(properties: Record<string, any> | undefined, basePath: string): void {
    if (!properties)
      return

    for (const [name, property] of Object.entries(properties)) {
      if (property.primary && property.autoIncrement)
        continue

      const path = `${basePath}.${name}`
      const nameTokens = splitIdentifier(name)
      const queries = Array.from(new Set([
        name,
        nameTokens.join(' '),
        ...nameTokens,
        typeof property.format === 'string' ? property.format : undefined,
        ...(Array.isArray(property.enum) ? property.enum.map(String) : []),
      ].filter((value): value is string => !!value && value.trim().length > 0)))

      fields.push({
        path,
        name,
        type: typeof property.type === 'string' ? property.type : undefined,
        required: true,
        queries: queries.slice(0, 8),
      })

      if (property.type === 'object')
        walk(property.properties, path)
      if (property.type === 'array' && property.items?.type === 'object')
        walk(property.items.properties, `${path}[]`)
    }
  }

  walk(schema.properties as Record<string, any>, '$')
  return fields
}

function getValueAtPath(data: unknown, path: string): unknown {
  if (path === '$')
    return data

  const parts = path
    .replace(JSON_PATH_PREFIX_RE, '')
    .replace(JSON_PATH_ARRAY_MARKER_RE, '')
    .split('.')
    .filter(Boolean)

  let current: any = data
  for (const part of parts) {
    if (Array.isArray(current)) {
      current = current[0]
    }
    if (!current || typeof current !== 'object')
      return undefined
    current = current[part]
  }
  return current
}

function validateEvidenceCoverage(data: unknown, evidence: FieldEvidence[], plan: RetrievalPlanField[]): EvidenceCoverageIssue[] {
  const issues: EvidenceCoverageIssue[] = []
  const evidenceByPath = new Map(evidence.map(item => [item.fieldPath, item]))

  for (const field of plan) {
    const value = getValueAtPath(data, field.path)
    const item = evidenceByPath.get(field.path)

    if (value === undefined) {
      issues.push({
        fieldPath: field.path,
        severity: 'warning',
        message: 'Field is not present in extracted data.',
      })
      continue
    }

    if (value === null) {
      if (item && item.status !== 'missing') {
        issues.push({
          fieldPath: field.path,
          severity: 'warning',
          message: 'Null field should use missing evidence status.',
        })
      }
      continue
    }

    if (!item) {
      issues.push({
        fieldPath: field.path,
        severity: 'warning',
        message: 'Non-null field has no evidence entry.',
      })
      continue
    }

    if (item.status === 'found' && (!item.chunkId || !item.snippet)) {
      issues.push({
        fieldPath: field.path,
        severity: 'warning',
        message: 'Found evidence should include chunkId and snippet.',
      })
    }
  }

  return issues
}

function summarizeEvidence(path: string, evidence: FieldEvidence[], issueCount: number, fieldCount: number): NonNullable<ExtractionResult['evidenceSummary']> {
  return {
    path,
    fieldCount,
    evidenceCount: evidence.length,
    foundCount: evidence.filter(item => item.status === 'found').length,
    missingCount: evidence.filter(item => item.status === 'missing').length,
    inferredCount: evidence.filter(item => item.status === 'inferred').length,
    issueCount,
  }
}

function reconcileEvidenceWithFinalData(data: unknown, submitted: FieldEvidence[], heuristic: FieldEvidence[], plan: RetrievalPlanField[]): FieldEvidence[] {
  if (submitted.length === 0)
    return heuristic

  const submittedByPath = new Map(submitted.map(item => [item.fieldPath, item]))
  const heuristicByPath = new Map(heuristic.map(item => [item.fieldPath, item]))

  return plan.map((field) => {
    const value = getValueAtPath(data, field.path)
    const submittedItem = submittedByPath.get(field.path)
    const heuristicItem = heuristicByPath.get(field.path)
    const searchText = primitiveToSearchText(value)

    if (!submittedItem) {
      return heuristicItem ?? {
        fieldPath: field.path,
        status: value === null || value === undefined ? 'missing' : 'inferred',
        confidence: value === null || value === undefined ? 0 : 0.25,
        note: 'No agent-provided evidence for planned field.',
      }
    }

    if (!searchText)
      return { ...submittedItem, status: 'missing', note: submittedItem.note ?? 'Final field value is null or empty.' }

    if (submittedItem.snippet && normalizeText(submittedItem.snippet).includes(normalizeText(searchText)))
      return submittedItem

    if (heuristicItem?.status === 'found') {
      return {
        ...heuristicItem,
        note: 'Evidence refreshed after final data correction or value mismatch.',
      }
    }

    return {
      ...submittedItem,
      status: 'inferred',
      confidence: Math.min(submittedItem.confidence ?? 0.3, 0.3),
      note: 'Agent evidence did not contain the final field value after correction; review recommended.',
    }
  })
}

function getUsageTokens(result: any): { prompt: number, completion: number } {
  const usage = result?.usage ?? {}
  const prompt = usage.inputTokens ?? usage.promptTokens ?? 0
  const completion = usage.outputTokens ?? usage.completionTokens ?? 0
  return { prompt, completion }
}

function normalizeToolInput(toolName: string, input: unknown): unknown {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    return input

  const data = { ...(input as Record<string, unknown>) }
  if ('chunkId' in data && typeof data.chunkId === 'string') {
    const parsed = Number(data.chunkId)
    if (Number.isInteger(parsed))
      data.chunkId = parsed
  }
  if ('start' in data && typeof data.start === 'string') {
    const parsed = Number(data.start)
    if (Number.isInteger(parsed))
      data.start = parsed
  }
  if ('length' in data && typeof data.length === 'string') {
    const parsed = Number(data.length)
    if (Number.isInteger(parsed))
      data.length = parsed
  }
  if ('limit' in data && typeof data.limit === 'string') {
    const parsed = Number(data.limit)
    if (Number.isInteger(parsed))
      data.limit = parsed
  }
  if (toolName === 'searchChunks' && 'query' in data && typeof data.query !== 'string') {
    data.query = String(data.query)
  }
  return data
}

function createHeuristicEvidence(data: unknown, chunks: Array<{ pageContent: string, metadata?: Record<string, unknown> }>): FieldEvidence[] {
  return flattenPrimitiveValues(data)
    .filter(({ path }) => path !== '$')
    .map(({ path, value }) => {
      const searchText = primitiveToSearchText(value)
      if (!searchText) {
        return {
          fieldPath: path,
          status: 'missing',
          confidence: 0,
          note: 'Value is null or empty.',
        }
      }

      const normalizedSearch = normalizeText(searchText)
      for (let i = 0; i < chunks.length; i++) {
        const chunkText = chunks[i].pageContent
        const offset = normalizeText(chunkText).indexOf(normalizedSearch)
        if (offset !== -1) {
          return {
            fieldPath: path,
            status: 'found',
            chunkId: i + 1,
            headingPath: headingPath(chunks[i].metadata),
            snippet: makeSnippet(chunkText, offset, searchText.length),
            confidence: typeof value === 'string' && value.length > 2 ? 0.75 : 0.6,
            note: 'Generated by heuristic value lookup after extraction.',
          }
        }
      }

      return {
        fieldPath: path,
        status: 'inferred',
        confidence: 0.3,
        note: 'Extracted value was not found by exact text lookup in document chunks.',
      }
    })
}

export async function extractStructuredDataWithAgent(input: {
  config: AIConfig
  schema: JsonSchemaDefinition
  text: string
  aiexDir: string
  modelOverride?: AIModelConfig
  onRetry?: (info: RetryInfo) => void
  onAgentStep?: (step: { thought?: string, toolCalls?: any[] }) => void
}): Promise<ExtractionResult> {
  const { config, schema, text, aiexDir, modelOverride, onRetry, onAgentStep } = input

  if (!config.provider.apiKey) {
    return { success: false, error: t('errors.ai.apiKeyMissing') }
  }

  const chunks = splitMarkdown(text, AGENT_CHUNK_SIZE)

  // Determine model
  const inputTokens = Math.ceil(text.length / 2)
  const fieldCount = schema.properties ? Object.keys(schema.properties).length : 0
  const outputTokens = fieldCount > 0 ? fieldCount * 80 : undefined

  let selected: SelectedModel
  try {
    selected = modelOverride ?? selectModel({
      models: config.provider.models,
      isImage: false,
      inputTokens,
      outputTokens,
    })
  }
  catch (e) {
    return { success: false, error: (e as Error).message }
  }

  if (selected.capabilities.supportsTools === false) {
    return {
      success: false,
      error: `ReAct Agent Mode requires a model that supports tool calling. Model "${selected.name}" is configured with supportsTools=false.`,
    }
  }

  const useTelemetry = !!(config.langfuse?.publicKey && config.langfuse.secretKey)

  try {
    if (useTelemetry) {
      initLangfuse(config)
    }

    const provider = createOpenAICompatible({
      baseURL: config.provider.baseURL,
      name: 'openai-compatible',
      apiKey: config.provider.apiKey,
      supportsStructuredOutputs: false, // ReAct mode uses tools, structured output option isn't compatible with tools in AI SDK
    })

    // Store extraction result locally when submitted by the tool
    let finalExtractedData: unknown = null
    let submittedEvidence: FieldEvidence[] = []
    let submitCount = 0
    const trace: AgentTraceEntry[] = []

    const documentFrequencies = new Map<string, number>()
    for (const chunk of chunks) {
      const tokens = tokenize(chunk.pageContent)
      for (const token of tokens) {
        documentFrequencies.set(token, (documentFrequencies.get(token) ?? 0) + 1)
      }
    }

    function tokenIdf(token: string): number {
      return Math.log((chunks.length + 1) / ((documentFrequencies.get(token) ?? 0) + 1)) + 1
    }

    function recordTool(name: string, input: unknown, output: unknown): void {
      trace.push({ type: 'tool', name, input, output })
    }

    const tools = {
      listChunks: tool({
        description: 'Get a list of text chunks in the document, showing chunk index ID, character size, and markdown heading hierarchy. Use this as a Table of Contents. For very large documents, use offset and limit.',
        parameters: z.object({
          offset: z.number().int().min(0).optional().describe('Zero-based offset into the chunk list. Defaults to 0.'),
          limit: z.number().int().min(1).max(200).optional().describe('Maximum chunks to return. Defaults to all chunks.'),
        }),
        execute: async ({ offset = 0, limit }: { offset?: number, limit?: number } = {}) => {
          const selectedChunks = chunks.slice(offset, limit ? offset + limit : undefined)
          const output = selectedChunks.map((c, idx) => ({
            id: offset + idx + 1,
            size: c.pageContent.length,
            headings: c.metadata,
            headingPath: headingPath(c.metadata),
          }))
          recordTool('listChunks', { offset, limit }, output)
          return output
        },
      } as any),
      summarizeChunks: tool({
        description: 'Get a compact high-level map of the document chunks grouped by heading path. Use this before detailed reads when the document has many chunks.',
        parameters: z.object({}),
        execute: async () => {
          const output = chunks.map((c, idx) => ({
            id: idx + 1,
            size: c.pageContent.length,
            headingPath: headingPath(c.metadata) || '(no heading)',
            preview: c.pageContent.slice(0, 180).replace(/\s+/g, ' ').trim(),
          }))
          recordTool('summarizeChunks', {}, output)
          return output
        },
      } as any),
      readChunk: tool({
        description: 'Read the full text content of a specific chunk by its ID.',
        parameters: z.object({
          chunkId: z.number().int().describe('The ID (1-based index) of the chunk to read.'),
        }),
        execute: async ({ chunkId }: { chunkId: number }) => {
          const index = chunkId - 1
          if (index < 0 || index >= chunks.length) {
            return { error: `Invalid chunkId: ${chunkId}. Valid IDs are 1 to ${chunks.length}.` }
          }
          const chunk = chunks[index]
          const output = {
            chunkId,
            headings: headingPath(chunk.metadata),
            content: chunk.pageContent,
          }
          recordTool('readChunk', { chunkId }, { chunkId, headings: output.headings, size: chunk.pageContent.length })
          return output
        },
      } as any),
      readChunkRange: tool({
        description: 'Read a bounded character range from a chunk. Prefer this over readChunk when search results identify a relevant area and the full chunk is too large.',
        parameters: z.object({
          chunkId: z.number().int().describe('The ID (1-based index) of the chunk to read.'),
          start: z.number().int().min(0).describe('Zero-based character offset within the chunk.'),
          length: z.number().int().min(1).max(MAX_RANGE_LENGTH).optional().describe(`Characters to read. Defaults to 3000 and is capped at ${MAX_RANGE_LENGTH}.`),
        }),
        execute: async ({ chunkId, start, length = 3000 }: { chunkId: number, start: number, length?: number }) => {
          const index = chunkId - 1
          if (index < 0 || index >= chunks.length) {
            return { error: `Invalid chunkId: ${chunkId}. Valid IDs are 1 to ${chunks.length}.` }
          }
          const chunk = chunks[index]
          const safeStart = Math.min(start, chunk.pageContent.length)
          const safeLength = Math.min(length, MAX_RANGE_LENGTH)
          const output = {
            chunkId,
            start: safeStart,
            end: Math.min(chunk.pageContent.length, safeStart + safeLength),
            headings: headingPath(chunk.metadata),
            content: chunk.pageContent.slice(safeStart, safeStart + safeLength),
          }
          recordTool('readChunkRange', { chunkId, start, length }, { ...output, content: `[${output.content.length} chars]` })
          return output
        },
      } as any),
      searchChunks: tool({
        description: 'Search all chunks for keywords or phrases. It ranks exact phrase hits first, then token coverage and rarity. Returns chunk IDs, character offsets, scores, and context snippets.',
        parameters: z.object({
          query: z.string().describe('The keyword or search phrase to search for.'),
          limit: z.number().int().min(1).max(MAX_SEARCH_LIMIT).optional().describe(`Maximum results to return. Defaults to ${DEFAULT_SEARCH_LIMIT}.`),
        }),
        execute: async ({ query, limit = DEFAULT_SEARCH_LIMIT }: { query: string, limit?: number }) => {
          const results: Array<{ chunkId: number, headings: any, headingPath: string, offset: number, score: number, snippet: string }> = []
          const normalizedQuery = normalizeText(query.trim())
          const queryTokens = tokenize(query)
          if (!normalizedQuery && queryTokens.length === 0) {
            return []
          }
          for (let i = 0; i < chunks.length; i++) {
            const chunkText = chunks[i].pageContent
            const normalizedChunk = normalizeText(chunkText)
            const exactIdx = normalizedQuery ? normalizedChunk.indexOf(normalizedQuery) : -1
            const matchedTokens = queryTokens.filter(token => normalizedChunk.includes(token))
            if (exactIdx !== -1 || matchedTokens.length > 0) {
              const offset = exactIdx !== -1
                ? exactIdx
                : Math.max(0, normalizedChunk.indexOf(matchedTokens[0] ?? ''))
              const heading = headingPath(chunks[i].metadata)
              const headingMatches = queryTokens.filter(token => normalizeText(heading).includes(token)).length
              const coverage = queryTokens.length > 0 ? matchedTokens.length / queryTokens.length : 0
              const rarityScore = matchedTokens.reduce((sum, token) => sum + tokenIdf(token), 0)
              const score = (exactIdx !== -1 ? 120 : 0)
                + coverage * 60
                + rarityScore * 12
                + headingMatches * 8
              results.push({
                chunkId: i + 1,
                headings: chunks[i].metadata,
                headingPath: heading,
                offset,
                score: Math.round(score * 100) / 100,
                snippet: makeSnippet(chunkText, offset, exactIdx !== -1 ? normalizedQuery.length : (matchedTokens[0]?.length ?? 1)),
              })
            }
          }
          const output = results
            .sort((a, b) => b.score - a.score || a.chunkId - b.chunkId)
            .slice(0, Math.min(limit, MAX_SEARCH_LIMIT))
          recordTool('searchChunks', { query, limit }, output)
          return output
        },
      } as any),
      submitExtraction: tool({
        description: 'Submit the final extracted JSON object conforming to the schema definition. Include optional field-level evidence keyed by JSON path when available. Call this ONLY after you have gathered all necessary information.',
        parameters: z.object({
          data: z.any().describe('The extracted JSON object conforming to the target schema.'),
          evidence: z.record(z.any()).optional().describe('Optional field evidence keyed by JSON path such as "$.name". Each value can include chunkId, headingPath, snippet, confidence, status, and note.'),
        }),
        execute: async ({ data, evidence }: { data: any, evidence?: unknown }) => {
          submitCount += 1
          finalExtractedData = data
          submittedEvidence = normalizeEvidenceMap(evidence)
          const output = {
            status: 'success',
            submitCount,
            evidenceCount: submittedEvidence.length,
            message: submitCount === 1
              ? 'Data submitted successfully. The extraction is now complete.'
              : 'Data submitted again. The latest submitted data will be used.',
          }
          recordTool('submitExtraction', { data, evidence }, output)
          return output
        },
      } as any),
    }

    const outputSchema = schemaToExtractionOutputSchema(schema)
    const retrievalPlan = buildRetrievalPlan(schema)
    trace.push({
      type: 'retrieval-plan',
      output: retrievalPlan,
    })

    const systemPrompt = `You are a precise data extraction agent. Your goal is to extract structured information from a document to populate the target JSON schema.
    
Target JSON Schema structure to populate:
${JSON.stringify(outputSchema, null, 2)}

Schema-aware retrieval plan:
${JSON.stringify(retrievalPlan, null, 2)}

You are equipped with tools to browse the document dynamically:
1. First, call listChunks or summarizeChunks to understand the document layout and what sections exist.
2. Follow the schema-aware retrieval plan. For each planned field, call searchChunks with one or more suggested queries to locate relevant evidence. Use readChunkRange for narrow evidence windows and readChunk only when you need the full chunk.
3. You can make multiple tool calls. Do not guess. Check the text carefully.
4. Once you have located and read all the necessary information, call the submitExtraction tool with the fully extracted JSON object.
5. After calling submitExtraction, you should stop.

CRITICAL RULES:
1. Extract data strictly conforming to the types and properties of the Target JSON Schema.
2. If a field's value cannot be found in the document after thorough search, set it to null.
3. Do not invent any values.
4. Call submitExtraction exactly once with the final JSON result.
5. When submitting, include evidence keyed by JSON path (for example "$.customerName") whenever possible. Evidence should include chunkId, headingPath, snippet, confidence from 0 to 1, and status ("found", "missing", or "inferred").
6. Every non-null planned field should have evidence. Null fields should use evidence status "missing".`

    const timeoutMs = (config.provider.timeout ?? 300) * 1000
    let totalPromptTokens = 0
    let totalCompletionTokens = 0

    function createAgent(): ToolLoopAgent<never, any> {
      return new ToolLoopAgent({
        id: 'aiex-extraction-agent',
        model: provider.chatModel(selected.name),
        instructions: systemPrompt,
        tools,
        stopWhen: [
          stepCountIs(18),
          hasToolCall('submitExtraction'),
          isLoopFinished(),
        ],
        experimental_telemetry: { isEnabled: useTelemetry },
        experimental_context: {
          aiexDir,
          schemaName: schema.table.name,
          traceId: `${schema.table.name}-${Date.now()}`,
        },
        prepareStep({ stepNumber, steps }: any) {
          const activeTools = (stepNumber === 0
            ? ['listChunks', 'summarizeChunks', 'searchChunks']
            : steps.some((step: any) => step.toolCalls?.some((call: any) => call.toolName === 'readChunk' || call.toolName === 'readChunkRange'))
              ? ['listChunks', 'summarizeChunks', 'searchChunks', 'readChunk', 'readChunkRange', 'submitExtraction']
              : ['listChunks', 'summarizeChunks', 'searchChunks', 'readChunk', 'readChunkRange']) as Array<keyof typeof tools>

          trace.push({
            type: 'prepare-step',
            input: { stepNumber, completedSteps: steps.length },
            output: { activeTools },
          })
          return { activeTools }
        },
        async experimental_repairToolCall({ toolCall, error }: any) {
          if (!toolCall?.toolName || typeof toolCall.input !== 'string') {
            return null
          }

          try {
            const input = safeParseJSON(toolCall.input)
            const repairedInput = normalizeToolInput(toolCall.toolName, input)
            const output = {
              ...toolCall,
              input: JSON.stringify(repairedInput),
            }
            trace.push({
              type: 'tool-repair',
              name: toolCall.toolName,
              input: { raw: toolCall.input, error: getErrorMessage(error) },
              output: repairedInput,
            })
            return output
          }
          catch {
            return null
          }
        },
        onStepFinish({ text, toolCalls }: any) {
          trace.push({ type: 'step', thought: text, toolCalls })
          if (onAgentStep) {
            onAgentStep({ thought: text, toolCalls })
          }
        },
        onFinish(event: any) {
          trace.push({
            type: 'finish',
            input: {
              finishReason: event.finishReason,
              stepCount: event.steps?.length,
            },
            output: {
              usage: event.totalUsage,
              warnings: event.warnings,
            },
          })
        },
      })
    }

    const result = await withRetry(() => createAgent().generate({
      prompt: 'Please start by mapping the chunks, then gather the required facts through search/read tools and submit the final JSON extraction.',
      abortSignal: AbortSignal.timeout(timeoutMs),
    }), onRetry)
    const usage = getUsageTokens(result)
    totalPromptTokens += usage.prompt
    totalCompletionTokens += usage.completion

    if (!finalExtractedData) {
      // If the model did not call submitExtraction but still finished, try to parse JSON from its final text response
      if (result.text) {
        try {
          finalExtractedData = safeParseJSON(result.text)
        }
        catch {
          // Ignore parse errors and fail below
        }
      }
    }

    if (!finalExtractedData) {
      return { success: false, error: 'Agent finished without submitting structured data.' }
    }

    // Validate the final data
    let validation = validateExtractedData(schema, finalExtractedData)
    for (let attempt = 1; !validation.success && attempt <= MAX_CORRECTION_ATTEMPTS; attempt++) {
      const previousValidationError = validation.error
      const correctionSystemPrompt = `You are a precise data correction assistant. Your task is to correct validation errors in a previously generated JSON object to make it comply with the JSON Schema.
      
JSON Schema Definition:
${JSON.stringify(outputSchema, null, 2)}

Validation Errors:
${previousValidationError}

Original Incorrect JSON:
${JSON.stringify(finalExtractedData, null, 2)}

Please output the corrected JSON object. Return ONLY the corrected JSON object, with no markdown tags or explanations.`

      function buildCorrectionOpts(): any {
        return {
          model: provider.chatModel(selected.name),
          system: correctionSystemPrompt,
          prompt: `Please correct the JSON output now. Correction attempt ${attempt} of ${MAX_CORRECTION_ATTEMPTS}.`,
          abortSignal: AbortSignal.timeout(timeoutMs),
          experimental_telemetry: { isEnabled: useTelemetry },
        }
      }

      const correctionResult = await withRetry(() => generateText(buildCorrectionOpts()), onRetry)
      const correctionUsage = getUsageTokens(correctionResult)
      totalPromptTokens += correctionUsage.prompt
      totalCompletionTokens += correctionUsage.completion

      try {
        const correctedData = safeParseJSON(correctionResult.text)
        finalExtractedData = correctedData
        validation = validateExtractedData(schema, correctedData)
        trace.push({
          type: 'correction',
          input: { attempt, validationError: previousValidationError },
          output: validation.success ? 'valid' : 'invalid',
        })
      }
      catch (error) {
        validation = { success: false, error: getErrorMessage(error) }
        trace.push({ type: 'correction', input: { attempt }, error: validation.error })
      }
    }

    if (!validation.success) {
      return { success: false, error: `Agent output validation failed: ${validation.error}` }
    }

    // Write final output to disk
    const outputDir = path.resolve(aiexDir, config.extraction?.outputDir?.replace('.aiex/', '') ?? 'extracted')
    await fs.mkdir(outputDir, { recursive: true })
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const outputFileName = `${schema.table.name}-${timestamp}.json`
    const outputPath = path.join(outputDir, outputFileName)
    await writeJsonFile(outputPath, finalExtractedData, { spaces: 2, EOL: '\n' })
    const heuristicEvidence = createHeuristicEvidence(finalExtractedData, chunks)
    const evidence = reconcileEvidenceWithFinalData(finalExtractedData, submittedEvidence, heuristicEvidence, retrievalPlan)
    const evidenceCoverageIssues = validateEvidenceCoverage(finalExtractedData, evidence, retrievalPlan)
    const evidenceSummary = summarizeEvidence('', evidence, evidenceCoverageIssues.length, retrievalPlan.length)
    trace.push({
      type: 'evidence-coverage',
      output: {
        ...evidenceSummary,
        issues: evidenceCoverageIssues,
      },
    })
    const evidencePath = path.join(outputDir, `${schema.table.name}-${timestamp}.evidence.json`)
    evidenceSummary.path = evidencePath
    await writeJsonFile(evidencePath, {
      model: selected.name,
      schema: schema.table.name,
      generatedBy: submittedEvidence.length > 0 ? 'agent' : 'heuristic',
      coverage: {
        ...evidenceSummary,
        issues: evidenceCoverageIssues,
      },
      fields: evidence,
    }, { spaces: 2, EOL: '\n' })
    const tracePath = path.join(outputDir, `${schema.table.name}-${timestamp}.agent-trace.json`)
    await writeJsonFile(tracePath, {
      model: selected.name,
      chunkSize: AGENT_CHUNK_SIZE,
      chunkCount: chunks.length,
      submitCount,
      evidencePath,
      evidenceSummary,
      trace,
    }, { spaces: 2, EOL: '\n' })

    return {
      success: true,
      outputPath,
      data: finalExtractedData,
      evidenceSummary,
      tokensUsed: {
        prompt: totalPromptTokens,
        completion: totalCompletionTokens,
        total: totalPromptTokens + totalCompletionTokens,
      },
    }
  }
  catch (error: unknown) {
    return { success: false, error: getErrorMessage(error) }
  }
}
