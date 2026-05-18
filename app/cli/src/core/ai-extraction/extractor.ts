import type { AIConfig, AIModelConfig, ExtractionResult } from './types'
import type { JsonSchemaDefinition, JsonSchemaProperty } from '@/core/schema-sqlite/schemas'
import type { RetryInfo } from '@/utils/retry'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { generateText, jsonSchema, Output } from 'ai'
import { getErrorMessage } from '@/core/schema-sqlite'
import { withRetry } from '@/utils/retry'
import { safeParseJSON } from './json-utils'
import { selectModel } from './model-selector'
import { generateExtractionPrompt } from './prompt-generator'
import { DEFAULT_PROMPT_CONFIG, PLACEHOLDER_TEXT } from './types'

export { selectModel }
export type { SelectedModel } from './model-selector'
export type { RetryInfo } from '@/utils/retry'

interface PromptSnapshot {
  system: string
  user: string
}

const SYSTEM_PROMPT_REGEX = /## System Prompt\n([\s\S]*?)(?=## User Prompt|$)/
const USER_PROMPT_REGEX = /## User Prompt Template\n([\s\S]*)$/

const MIME_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
  txt: 'text/plain',
  csv: 'text/csv',
  json: 'application/json',
  md: 'text/markdown',
  html: 'text/html',
}

function detectMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase().replace('.', '')
  return MIME_TYPES[ext] || 'application/octet-stream'
}

interface ImageContentPart { type: 'image', image: Uint8Array, mimeType?: string }
interface FileContentPart { type: 'file', data: Uint8Array, mediaType: string, filename?: string }
type ReadFilePartResult = ImageContentPart | FileContentPart

async function readFilePart(filePath: string): Promise<ReadFilePartResult> {
  const mime = detectMimeType(filePath)
  const buffer = await fs.readFile(filePath)
  const name = path.basename(filePath)

  if (mime.startsWith('image/')) {
    return { type: 'image', image: buffer, mimeType: mime }
  }
  return { type: 'file', data: buffer, mediaType: mime, filename: name }
}

function nullableType(type: string): string[] {
  return type === 'null' ? ['null'] : [type, 'null']
}

function propertyToExtractionSchema(property: JsonSchemaProperty): Record<string, unknown> {
  if (property.type === 'array') {
    return {
      type: nullableType('array'),
      items: property.items ? propertyToExtractionSchema(property.items) : {},
    }
  }

  if (property.type === 'object') {
    const childProperties = property.properties
      ? Object.fromEntries(
          Object.entries(property.properties).map(([name, prop]) => [name, propertyToExtractionSchema(prop)]),
        )
      : undefined

    return {
      type: nullableType('object'),
      ...(childProperties
        ? {
            properties: childProperties,
            required: Object.keys(childProperties),
            additionalProperties: false,
          }
        : { additionalProperties: true }),
    }
  }

  return {
    type: nullableType(property.type),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function schemaToExtractionOutputSchema(schema: JsonSchemaDefinition): Record<string, unknown> {
  const properties = Object.fromEntries(
    Object.entries(schema.properties)
      .filter(([, prop]) => !(prop.primary && prop.autoIncrement))
      .map(([name, prop]) => [name, propertyToExtractionSchema(prop)]),
  )

  return {
    type: 'object',
    additionalProperties: false,
    properties,
    required: Object.keys(properties),
  }
}

function validatePropertyValue(path: string, property: JsonSchemaProperty, value: unknown, issues: string[]): void {
  if (value === null)
    return

  switch (property.type) {
    case 'string':
      if (typeof value !== 'string')
        issues.push(`${path}: expected string or null`)
      return
    case 'integer':
      if (!Number.isInteger(value))
        issues.push(`${path}: expected integer or null`)
      return
    case 'number':
      if (typeof value !== 'number' || Number.isNaN(value))
        issues.push(`${path}: expected number or null`)
      return
    case 'boolean':
      if (typeof value !== 'boolean')
        issues.push(`${path}: expected boolean or null`)
      return
    case 'array':
      if (!Array.isArray(value)) {
        issues.push(`${path}: expected array or null`)
        return
      }
      if (property.items) {
        const itemProperty = property.items
        value.forEach((item, index) => validatePropertyValue(`${path}[${index}]`, itemProperty, item, issues))
      }
      return
    case 'object': {
      if (!isRecord(value)) {
        issues.push(`${path}: expected object or null`)
        return
      }
      if (property.properties)
        validateProperties(path, property.properties, value, issues)
      return
    }
    case 'null':
      issues.push(`${path}: expected null`)
  }
}

function validateProperties(
  basePath: string,
  properties: Record<string, JsonSchemaProperty>,
  data: Record<string, unknown>,
  issues: string[],
): void {
  const expected = Object.entries(properties)
    .filter(([, prop]) => !(prop.primary && prop.autoIncrement))

  const expectedKeys = new Set(expected.map(([name]) => name))
  for (const key of Object.keys(data)) {
    if (!expectedKeys.has(key))
      issues.push(`${basePath}.${key}: unexpected field`)
  }

  for (const [name, prop] of expected) {
    const path = `${basePath}.${name}`
    if (!(name in data)) {
      issues.push(`${path}: missing field`)
      continue
    }
    validatePropertyValue(path, prop, data[name], issues)
  }
}

export function validateExtractedData(
  schema: JsonSchemaDefinition,
  data: unknown,
): { success: true } | { success: false, error: string } {
  if (!isRecord(data)) {
    return { success: false, error: 'Extracted data must be a JSON object.' }
  }

  const issues: string[] = []
  validateProperties('$', schema.properties, data, issues)
  if (issues.length > 0) {
    return {
      success: false,
      error: `Extracted data does not match schema:\n${issues.map(issue => `  - ${issue}`).join('\n')}`,
    }
  }

  return { success: true }
}

async function loadPromptSnapshot(aiexDir: string, tableName: string): Promise<PromptSnapshot | null> {
  const snapshotPath = path.join(aiexDir, 'extracted', `${tableName}.prompt.md`)

  try {
    const content = await fs.readFile(snapshotPath, 'utf-8')

    const systemMatch = content.match(SYSTEM_PROMPT_REGEX)
    const userMatch = content.match(USER_PROMPT_REGEX)

    if (systemMatch && userMatch) {
      return {
        system: systemMatch[1].trim(),
        user: userMatch[1].trim(),
      }
    }
  }
  catch {
  }

  return null
}

export async function extractStructuredData(input: {
  config: AIConfig
  schema: JsonSchemaDefinition
  text: string
  aiexDir: string
  file?: string
  modelOverride?: AIModelConfig
  onRetry?: (info: RetryInfo) => void
}): Promise<ExtractionResult> {
  const { config, schema, text, aiexDir, file, modelOverride } = input

  if (!config.provider.apiKey) {
    return { success: false, error: 'API Key not configured. Please configure AI settings in the web UI.' }
  }

  const useFileContent = !!file
  const isImageFile = useFileContent && detectMimeType(file!).startsWith('image/')

  const inputTokens = text ? Math.ceil(text.length / 2) : undefined

  const fieldCount = schema.properties ? Object.keys(schema.properties).length : 0
  const outputTokens = fieldCount > 0 ? fieldCount * 80 : undefined

  const selected = modelOverride ?? selectModel({
    models: config.provider.models,
    isImage: isImageFile,
    fileName: file,
    inputTokens,
    outputTokens,
  })

  const useStructuredOutput = selected.capabilities.structuredOutput

  try {
    const provider = createOpenAICompatible({
      baseURL: config.provider.baseURL,
      name: 'qwen',
      apiKey: config.provider.apiKey,
    })

    let system: string
    let user: string

    const snapshot = await loadPromptSnapshot(aiexDir, schema.table.name)

    const promptText = file ? PLACEHOLDER_TEXT : text

    if (snapshot) {
      system = snapshot.system
      user = snapshot.user.replaceAll(PLACEHOLDER_TEXT, promptText)
    }
    else {
      const promptConfig = config.prompt ?? DEFAULT_PROMPT_CONFIG
      const generated = generateExtractionPrompt(schema, promptText, promptConfig)
      system = generated.system
      user = generated.user
    }

    const outputSchema = jsonSchema<Record<string, unknown>>(
      schemaToExtractionOutputSchema(schema),
    )

    let result

    if (useFileContent) {
      const filePart = await readFilePart(file!)
      const userContent = user.includes(PLACEHOLDER_TEXT)
        ? user.replaceAll(PLACEHOLDER_TEXT, text || `Data is contained in the attached file: ${filePart.filename || path.basename(file!)}`)
        : user

      const contentParts: any[] = [{ type: 'text' as const, text: userContent }, filePart]

      const fileOpts: any = {
        model: provider.chatModel(selected.name),
        system,
        messages: [
          { role: 'user', content: contentParts },
        ],
        abortSignal: AbortSignal.timeout(120_000),
        maxRetries: 0,
      }
      if (useStructuredOutput) {
        fileOpts.output = Output.object({ schema: outputSchema })
      }
      result = await withRetry(() => generateText(fileOpts), input.onRetry)
    }
    else {
      const textOpts: any = {
        model: provider.chatModel(selected.name),
        system,
        prompt: user,
        abortSignal: AbortSignal.timeout(60_000),
        maxRetries: 0,
      }
      if (useStructuredOutput) {
        textOpts.output = Output.object({ schema: outputSchema })
      }
      result = await withRetry(() => generateText(textOpts), input.onRetry)
    }

    let data: unknown
    if (useStructuredOutput) {
      data = result.output
    }
    else {
      data = safeParseJSON(result.text)
    }

    const validation = validateExtractedData(schema, data)
    if (!validation.success) {
      return { success: false, error: validation.error }
    }

    const outputDir = path.resolve(aiexDir, config.extraction.outputDir.replace('.aiex/', ''))
    await fs.mkdir(outputDir, { recursive: true })

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const outputFileName = `${schema.table.name}-${timestamp}.json`
    const outputPath = path.join(outputDir, outputFileName)

    await fs.writeFile(outputPath, `${JSON.stringify(data, null, 2)}\n`)

    return {
      success: true,
      outputPath,
      data,
      tokensUsed: result.usage
        ? {
            prompt: result.usage.inputTokens ?? 0,
            completion: result.usage.outputTokens ?? 0,
            total: (result.usage.inputTokens ?? 0) + (result.usage.outputTokens ?? 0),
          }
        : undefined,
    }
  }
  catch (error: unknown) {
    return { success: false, error: getErrorMessage(error) }
  }
}
