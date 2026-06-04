import type { SelectedModel } from '@/domain/ai-extraction/model-selector'
import type { AIConfig, AIModelConfig, ExtractionResult } from '@/domain/ai/types'
import type { JsonSchemaDefinition } from '@/domain/schema/schemas'
import type { RetryInfo } from '@/utils/retry'
import path from 'node:path'
import { generateText, jsonSchema, Output } from 'ai'
import { stripEvidence, verifyFieldEvidence } from '@/domain/ai-extraction/evidence'
import { safeParseJSON } from '@/domain/ai-extraction/json-utils'
import { selectModel } from '@/domain/ai-extraction/model-selector'
import { generateExtractionPrompt } from '@/domain/ai-extraction/prompt-generator'
import { schemaToExtractionOutputSchema, validateExtractedData } from '@/domain/ai-extraction/validator'
import { buildCorrectionUserPrompt, CORRECTION_SYSTEM_PROMPT, DEFAULT_PROMPT_CONFIG, EVIDENCE_INSTRUCTIONS, PLACEHOLDER_TEXT } from '@/domain/ai/prompts'
import { withEvidenceSchema } from '@/domain/extraction/evidence-schema'
import { calculateMissingFields } from '@/domain/extraction/field-completeness'
import { initLangfuse } from '@/infrastructure/ai/langfuse-telemetry'
import { createOpenAICompatibleProvider } from '@/infrastructure/ai/openai-compatible-client'
import { loadPromptSnapshot } from '@/infrastructure/extraction/prompt-snapshot'
import { writeExtractionOutput } from '@/infrastructure/extraction/write-extraction-output'
import { detectMimeType, readFilePart } from '@/infrastructure/input/file-parts'
import { t } from '@/locales'
import { getErrorMessage } from '@/utils/error'
import { withRetry } from '@/utils/retry'

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

    const provider = createOpenAICompatibleProvider({
      provider: config.provider,
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
          const outputPath = await writeExtractionOutput({
            aiexDir,
            outputDir: config.extraction.outputDir,
            tableName: schema.table.name,
            data: businessData,
          })

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

        systemPrompt = CORRECTION_SYSTEM_PROMPT
        userPrompt = buildCorrectionUserPrompt({
          text,
          schema: schemaToExtractionOutputSchema(schema),
          invalidJson,
          error: errorMsg,
          includeEvidenceInstructions: canLocateEvidence,
        })
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
