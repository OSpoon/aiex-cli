import type { AIConfig, AIModelConfig, ExtractionResult } from './types'
import type { JsonSchemaDefinition } from '@/core/schema-sqlite/schemas'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { generateText, jsonSchema, Output } from 'ai'
import { getErrorMessage } from '@/core/schema-sqlite'
import tableSchemaFile from '~/schemas/table-schema.json'
import { safeParseJSON } from './json-utils'
import { selectModel } from './model-selector'
import { generateExtractionPrompt } from './prompt-generator'
import { DEFAULT_PROMPT_CONFIG, PLACEHOLDER_TEXT } from './types'

export { selectModel }
export type { SelectedModel } from './model-selector'

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

interface ImageFilePart { type: 'image', name: string, image: string }
interface GenericFilePart { type: 'file', name: string, data: string, mimeType: string }
type ReadFilePartResult = ImageFilePart | GenericFilePart

async function readFilePart(filePath: string): Promise<ReadFilePartResult> {
  const mime = detectMimeType(filePath)
  const buffer = await fs.readFile(filePath)
  const base64 = buffer.toString('base64')
  const dataUri = `data:${mime};base64,${base64}`
  const name = path.basename(filePath)

  if (mime.startsWith('image/')) {
    return { type: 'image', name, image: dataUri }
  }
  return { type: 'file', name, data: dataUri, mimeType: mime }
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

    if (snapshot) {
      system = snapshot.system
      user = snapshot.user.replaceAll(PLACEHOLDER_TEXT, text)
    }
    else {
      const promptConfig = config.prompt ?? DEFAULT_PROMPT_CONFIG
      const generated = generateExtractionPrompt(schema, text, promptConfig)
      system = generated.system
      user = generated.user
    }

    const outputSchema = jsonSchema<Record<string, unknown>>(
      tableSchemaFile as Record<string, unknown>,
    )

    let result

    if (useFileContent) {
      const filePart = await readFilePart(file!)
      const fileName = filePart.name
      const userContent = user.includes(PLACEHOLDER_TEXT)
        ? user.replaceAll(PLACEHOLDER_TEXT, text || `Data is contained in the attached file: ${fileName}`)
        : user

      const contentParts: any[] = [{ type: 'text' as const, text: userContent }]
      if (filePart.type === 'image') {
        contentParts.push({ type: 'image', image: filePart.image })
      }
      else {
        contentParts.push({ type: 'file', data: filePart.data, mimeType: filePart.mimeType })
      }

      const fileOpts: any = {
        model: provider.chatModel(selected.name),
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: contentParts },
        ],
        abortSignal: AbortSignal.timeout(120_000),
      }
      if (useStructuredOutput) {
        fileOpts.output = Output.object({ schema: outputSchema })
      }
      result = await generateText(fileOpts)
    }
    else {
      const textOpts: any = {
        model: provider.chatModel(selected.name),
        system,
        prompt: user,
        abortSignal: AbortSignal.timeout(60_000),
      }
      if (useStructuredOutput) {
        textOpts.output = Output.object({ schema: outputSchema })
      }
      result = await generateText(textOpts)
    }

    let data: unknown
    if (useStructuredOutput) {
      data = result.output
    }
    else {
      data = safeParseJSON(result.text)
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
