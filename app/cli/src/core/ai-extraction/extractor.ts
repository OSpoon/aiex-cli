import type { AIConfig, AIModelConfig, ExtractionResult, JsonSchemaDefinition, SelectedModel } from '@/types'
import type { RetryInfo } from '@/utils/retry'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { generateText, jsonSchema, Output } from 'ai'
import { getErrorMessage } from '@/core/schema-sqlite'
import { t } from '@/locales'
import { withRetry } from '@/utils/retry'
import { safeParseJSON } from './json-utils'
import { selectModel } from './model-selector'
import { generateExtractionPrompt } from './prompt-generator'
import { initLangfuse } from './telemetry'
import { DEFAULT_PROMPT_CONFIG } from './types'
import { schemaToExtractionOutputSchema, validateExtractedData } from './validator'

export { selectModel }
export { schemaToExtractionOutputSchema, validateExtractedData } from './validator'
export type { SelectedModel } from '@/types'
export type { RetryInfo } from '@/utils/retry'

const OPENAI_COMPATIBLE_PROVIDER_NAME = 'openai-compatible'

export async function extractStructuredData(input: {
  config: AIConfig
  schema: JsonSchemaDefinition
  text: string
  aiexDir: string
  modelOverride?: AIModelConfig
  onRetry?: (info: RetryInfo) => void
}): Promise<ExtractionResult> {
  const { config, schema, text, modelOverride } = input

  if (!config.provider.apiKey) {
    return { success: false, error: t('errors.ai.apiKeyMissing') }
  }

  const inputTokens = text ? Math.ceil(text.length / 2) : undefined

  const fieldCount = schema.properties ? Object.keys(schema.properties).length : 0
  const outputTokens = fieldCount > 0 ? fieldCount * 80 : undefined

  let selected: SelectedModel
  try {
    selected = modelOverride ?? selectModel({
      models: config.provider.models,
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

    const promptConfig = config.prompt ?? DEFAULT_PROMPT_CONFIG
    const { system, user } = generateExtractionPrompt(schema, text, promptConfig)

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
          return {
            success: true,
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
3. Use only values supported by the original text. If a value cannot be confirmed, set it to null.
4. Remove any fields not defined by the JSON Schema.
5. Normalize values to the expected JSON type without changing the intended meaning.
6. Return ONLY the corrected JSON object. No explanations, no markdown blocks other than JSON.`

        userPrompt = `The JSON data you generated previously failed validation. Please correct it.

[Original Text]
${text || 'Original text is empty.'}

[JSON Schema Definition]
${JSON.stringify(schemaToExtractionOutputSchema(schema), null, 2)}

[Previously Generated Invalid JSON]
${invalidJson}

[Validation Error Details]
${errorMsg}

Correction checklist:
- Fix each field path mentioned in the validation error.
- Keep schema-valid fields unchanged.
- Do not invent missing facts; use null when the original text does not support a value.

Please output the corrected JSON object now:`
      }
    }

    return { success: false, error: lastError || 'Extraction failed after self-reflection retries' }
  }
  catch (error: unknown) {
    return { success: false, error: getErrorMessage(error) }
  }
}
