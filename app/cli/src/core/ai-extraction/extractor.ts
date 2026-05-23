import type { SelectedModel } from './model-selector'
import type { AIConfig, AIModelConfig, ExtractionResult } from './types'
import type { JsonSchemaDefinition, JsonSchemaProperty } from '@/core/schema-sqlite/schemas'
import type { RetryInfo } from '@/utils/retry'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { LangfuseSpanProcessor } from '@langfuse/otel'
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node'
import { generateText, jsonSchema, Output } from 'ai'
import { writeFile as writeJsonFile } from 'jsonfile'
import mime from 'mime'
import { getErrorMessage } from '@/core/schema-sqlite'
import { t } from '@/locales'
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

let langfuseInitialized = false

function initLangfuse(config: AIConfig): void {
  if (!config.langfuse?.publicKey || !config.langfuse.secretKey)
    return
  if (langfuseInitialized)
    return
  langfuseInitialized = true

  try {
    const provider = new NodeTracerProvider({
      spanProcessors: [
        new LangfuseSpanProcessor({
          publicKey: config.langfuse.publicKey,
          secretKey: config.langfuse.secretKey,
          baseUrl: config.langfuse.host || 'https://us.cloud.langfuse.com',
          exportMode: 'immediate',
        }),
      ],
    })

    provider.register()
  }
  catch (e) {
    console.warn('[Langfuse] Failed to initialize tracing:', e instanceof Error ? e.message : e)
  }
}

const SYSTEM_PROMPT_REGEX = /## System Prompt\n([\s\S]*?)(?=## User Prompt|$)/
const USER_PROMPT_REGEX = /## User Prompt Template\n([\s\S]*)$/
const OPENAI_COMPATIBLE_PROVIDER_NAME = 'openai-compatible'

function detectMimeType(filePath: string): string {
  return mime.getType(filePath) ?? 'application/octet-stream'
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
    return { success: false, error: t('errors.ai.apiKeyMissing') }
  }

  const useFileContent = !!file
  const isImageFile = useFileContent && detectMimeType(file!).startsWith('image/')

  const inputTokens = text ? Math.ceil(text.length / 2) : undefined

  const fieldCount = schema.properties ? Object.keys(schema.properties).length : 0
  const outputTokens = fieldCount > 0 ? fieldCount * 80 : undefined

  let selected: SelectedModel
  try {
    selected = modelOverride ?? selectModel({
      models: config.provider.models,
      isImage: isImageFile,
      fileName: file,
      inputTokens,
      outputTokens,
    })
  }
  catch (e) {
    return { success: false, error: (e as Error).message }
  }

  const useStructuredOutput = selected.capabilities.structuredOutput

  const useTelemetry = !!(config.langfuse?.publicKey && config.langfuse.secretKey)

  try {
    if (useTelemetry) {
      initLangfuse(config)
    }

    const provider = createOpenAICompatible({
      baseURL: config.provider.baseURL,
      name: OPENAI_COMPATIBLE_PROVIDER_NAME,
      apiKey: config.provider.apiKey,
      supportsStructuredOutputs: useStructuredOutput,
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

    const timeoutMs = (config.provider.timeout ?? 300) * 1000

    let systemPrompt = system
    let userPrompt = user
    const maxAttempts = 3
    let lastError = ''
    let totalPromptTokens = 0
    let totalCompletionTokens = 0

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      let result: any = null
      let data: unknown
      let parseError: string | undefined
      let validationError: string | undefined

      try {
        if (useFileContent) {
          const filePart = await readFilePart(file!)
          const fileName = filePart.type === 'file' ? filePart.filename : path.basename(file!)
          const userContent = userPrompt.includes(PLACEHOLDER_TEXT)
            ? userPrompt.replaceAll(PLACEHOLDER_TEXT, text || `Data is contained in the attached file: ${fileName}`)
            : userPrompt

          const contentParts: any[] = [{ type: 'text' as const, text: userContent }, filePart]

          const fileOpts: any = {
            model: provider.chatModel(selected.name),
            system: systemPrompt,
            messages: [
              { role: 'user', content: contentParts },
            ],
            abortSignal: AbortSignal.timeout(timeoutMs),
            maxRetries: 0,
            experimental_telemetry: { isEnabled: useTelemetry },
          }
          if (useStructuredOutput) {
            fileOpts.output = Output.object({ schema: outputSchema })
          }
          result = await withRetry(() => generateText(fileOpts), input.onRetry)
        }
        else {
          const textOpts: any = {
            model: provider.chatModel(selected.name),
            system: systemPrompt,
            prompt: userPrompt,
            abortSignal: AbortSignal.timeout(timeoutMs),
            maxRetries: 0,
            experimental_telemetry: { isEnabled: useTelemetry },
          }
          if (useStructuredOutput) {
            textOpts.output = Output.object({ schema: outputSchema })
          }
          result = await withRetry(() => generateText(textOpts), input.onRetry)
        }

        if (result.usage) {
          totalPromptTokens += result.usage.inputTokens ?? 0
          totalCompletionTokens += result.usage.outputTokens ?? 0
        }

        if (useStructuredOutput) {
          data = result.output
        }
        else {
          try {
            data = safeParseJSON(result.text)
          }
          catch (e) {
            parseError = e instanceof Error ? e.message : String(e)
          }
        }
      }
      catch (error: unknown) {
        parseError = getErrorMessage(error)
      }

      if (!parseError && data !== undefined) {
        const validation = validateExtractedData(schema, data)
        if (validation.success) {
          const outputDir = path.resolve(aiexDir, config.extraction.outputDir.replace('.aiex/', ''))
          await fs.mkdir(outputDir, { recursive: true })

          const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
          const outputFileName = `${schema.table.name}-${timestamp}.json`
          const outputPath = path.join(outputDir, outputFileName)

          await writeJsonFile(outputPath, data, { spaces: 2, EOL: '\n' })

          return {
            success: true,
            outputPath,
            data,
            tokensUsed: {
              prompt: totalPromptTokens,
              completion: totalCompletionTokens,
              total: totalPromptTokens + totalCompletionTokens,
            },
          }
        }
        else {
          validationError = validation.error
        }
      }

      const errorMsg = parseError || validationError || 'Unknown validation error'
      lastError = errorMsg

      if (attempt < maxAttempts) {
        const invalidJson = data !== undefined ? JSON.stringify(data, null, 2) : (result ? result.text : '')

        systemPrompt = `You are a precise data correction assistant. Your task is to correct validation errors in a previously generated JSON object to make it comply with the provided JSON Schema.
        
CRITICAL RULES:
1. Only correct the fields that failed validation.
2. Preserve all other correctly extracted fields and their values exactly.
3. Return ONLY the corrected JSON object. No explanations, no markdown blocks other than JSON.`

        userPrompt = `The JSON data you generated previously failed validation. Please correct it.

[Original Text]
${text || 'Data is contained in the attached file.'}

[JSON Schema Definition]
${JSON.stringify(schemaToExtractionOutputSchema(schema), null, 2)}

[Previously Generated Invalid JSON]
${invalidJson}

[Validation Error Details]
${errorMsg}

Please output the corrected JSON object now:`
      }
    }

    return { success: false, error: lastError || 'Extraction failed after self-reflection retries' }
  }
  catch (error: unknown) {
    return { success: false, error: getErrorMessage(error) }
  }
}
