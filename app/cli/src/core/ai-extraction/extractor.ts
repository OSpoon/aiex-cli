import type { SelectedModel } from './model-selector'
import type { AIConfig, AIModelConfig, ExtractionResult } from './types'
import type { JsonSchemaDefinition } from '@/core/schema-sqlite/schemas'
import type { RetryInfo } from '@/utils/retry'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { generateText, jsonSchema, Output } from 'ai'
import { writeFile as writeJsonFile } from 'jsonfile'
import { getErrorMessage } from '@/core/schema-sqlite'
import { t } from '@/locales'
import { withRetry } from '@/utils/retry'
import { stripEvidence, verifyFieldEvidence } from './evidence'
import { detectMimeType, readFilePart } from './file-utils'
import { safeParseJSON } from './json-utils'
import { selectModel } from './model-selector'
import { generateExtractionPrompt } from './prompt-generator'
import { loadPromptSnapshot } from './snapshot'
import { initLangfuse } from './telemetry'
import { DEFAULT_PROMPT_CONFIG, PLACEHOLDER_TEXT } from './types'
import { schemaToExtractionOutputSchema, validateExtractedData } from './validator'

export { selectModel }
export type { SelectedModel } from './model-selector'
export { schemaToExtractionOutputSchema, validateExtractedData } from './validator'
export type { RetryInfo } from '@/utils/retry'

const OPENAI_COMPATIBLE_PROVIDER_NAME = 'openai-compatible'
const EVIDENCE_INSTRUCTIONS = `Evidence requirements:
- Also return a top-level "_evidence" object.
- For each top-level scalar field you extracted from the text, include "_evidence.<field>.quote".
- The quote must be an exact contiguous substring copied from the input text.
- Do not invent offsets. Only provide quotes.
- If no exact quote supports a field, omit that field from "_evidence".`

function expectedExtractionFields(schema: JsonSchemaDefinition): string[] {
  return Object.entries(schema.properties)
    .filter(([, prop]) => !(prop.primary && prop.autoIncrement))
    .map(([name]) => name)
}

function calculateMissingFields(schema: JsonSchemaDefinition, data: unknown): { fields: string[], rate: number } {
  const expected = expectedExtractionFields(schema)
  if (expected.length === 0)
    return { fields: [], rate: 0 }
  if (!data || typeof data !== 'object' || Array.isArray(data))
    return { fields: expected, rate: 1 }

  const record = data as Record<string, unknown>
  const fields = expected.filter((field) => {
    const value = record[field]
    return value === undefined || value === null || value === ''
  })
  return { fields, rate: fields.length / expected.length }
}

function withEvidenceSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const properties = isRecord(schema.properties) ? schema.properties : {}
  const required = Array.isArray(schema.required) ? schema.required : []
  return {
    ...schema,
    properties: {
      ...properties,
      _evidence: {
        type: ['object', 'null'],
        additionalProperties: {
          type: 'object',
          additionalProperties: false,
          properties: {
            quote: { type: 'string' },
          },
          required: ['quote'],
        },
      },
    },
    required,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
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
  let apiRetryCount = 0

  const onApiRetry = (info: RetryInfo): void => {
    apiRetryCount += 1
    input.onRetry?.(info)
  }

  if (!config.provider.apiKey) {
    return {
      success: false,
      error: t('errors.ai.apiKeyMissing'),
      quality: {
        ai: {
          validationPassed: false,
          attempts: 0,
          selfCorrectionCount: 0,
          apiRetryCount,
        },
      },
    }
  }

  const useFileContent = !!file
  const fileMime = useFileContent ? await detectMimeType(file!) : ''
  const isImageFile = fileMime.startsWith('image/')
  const canLocateEvidence = !useFileContent && text.trim().length > 0

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
    return {
      success: false,
      error: (e as Error).message,
      quality: {
        ai: {
          validationPassed: false,
          attempts: 0,
          selfCorrectionCount: 0,
          apiRetryCount,
        },
      },
    }
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

    const extractionSchema = schemaToExtractionOutputSchema(schema)
    const outputSchema = jsonSchema<Record<string, unknown>>(
      canLocateEvidence ? withEvidenceSchema(extractionSchema) : extractionSchema,
    )

    const timeoutMs = (config.provider.timeout ?? 300) * 1000

    let systemPrompt = system
    let userPrompt = user
    if (canLocateEvidence)
      userPrompt = `${userPrompt}\n\n${EVIDENCE_INSTRUCTIONS}`
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
          result = await withRetry(() => generateText(fileOpts), onApiRetry)
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
          result = await withRetry(() => generateText(textOpts), onApiRetry)
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
        const stripped = canLocateEvidence ? stripEvidence(data) : { data }
        const businessData = stripped.data
        const validation = validateExtractedData(schema, businessData)
        if (validation.success) {
          const missing = calculateMissingFields(schema, businessData)
          const evidence = canLocateEvidence
            ? verifyFieldEvidence({
                schema,
                text,
                data: businessData,
                rawEvidence: stripped.rawEvidence,
              })
            : undefined
          const outputDir = path.resolve(aiexDir, config.extraction.outputDir.replace('.aiex/', ''))
          await fs.mkdir(outputDir, { recursive: true })

          const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
          const outputFileName = `${schema.table.name}-${timestamp}.json`
          const outputPath = path.join(outputDir, outputFileName)

          await writeJsonFile(outputPath, businessData, { spaces: 2, EOL: '\n' })

          return {
            success: true,
            outputPath,
            data: businessData,
            evidence,
            tokensUsed: {
              prompt: totalPromptTokens,
              completion: totalCompletionTokens,
              total: totalPromptTokens + totalCompletionTokens,
            },
            quality: {
              ai: {
                validationPassed: true,
                attempts: attempt,
                selfCorrectionCount: attempt - 1,
                apiRetryCount,
                missingFields: missing.fields,
                missingFieldRate: missing.rate,
              },
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
        const invalidJson = data !== undefined ? JSON.stringify(canLocateEvidence ? stripEvidence(data).data : data, null, 2) : (result ? result.text : '')

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

${canLocateEvidence ? EVIDENCE_INSTRUCTIONS : ''}

Please output the corrected JSON object now:`
      }
    }

    return {
      success: false,
      error: lastError || 'Extraction failed after self-reflection retries',
      quality: {
        ai: {
          validationPassed: false,
          attempts: maxAttempts,
          selfCorrectionCount: maxAttempts - 1,
          apiRetryCount,
          validationError: lastError,
        },
      },
    }
  }
  catch (error: unknown) {
    return {
      success: false,
      error: getErrorMessage(error),
      quality: {
        ai: {
          validationPassed: false,
          attempts: 0,
          selfCorrectionCount: 0,
          apiRetryCount,
          validationError: getErrorMessage(error),
        },
      },
    }
  }
}
