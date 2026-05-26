import type { SelectedModel } from './model-selector'
import type { AIConfig, AIModelConfig, ExtractionResult } from './types'
import type { JsonSchemaDefinition } from '@/core/schema-sqlite/schemas'
import type { RetryInfo } from '@/utils/retry'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { generateText, tool } from 'ai'
import { writeFile as writeJsonFile } from 'jsonfile'
import { z } from 'zod'
import { getErrorMessage } from '@/core/schema-sqlite'
import { t } from '@/locales'
import { safeParseJSON } from './json-utils'
import { selectModel } from './model-selector'
import { initLangfuse } from './telemetry'
import { splitMarkdown } from './text-splitter'
import { schemaToExtractionOutputSchema, validateExtractedData } from './validator'

export async function extractStructuredDataWithAgent(input: {
  config: AIConfig
  schema: JsonSchemaDefinition
  text: string
  aiexDir: string
  modelOverride?: AIModelConfig
  onRetry?: (info: RetryInfo) => void
  onAgentStep?: (step: { thought?: string, toolCalls?: any[] }) => void
}): Promise<ExtractionResult> {
  const { config, schema, text, aiexDir, modelOverride, onAgentStep } = input

  if (!config.provider.apiKey) {
    return { success: false, error: t('errors.ai.apiKeyMissing') }
  }

  // Pre-split the document text into chunks
  // We use a chunk size of 15000 chars to fit easily into context windows
  const chunks = splitMarkdown(text, 15000)

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

    const tools = {
      listChunks: tool({
        description: 'Get a list of all text chunks in the document, showing their chunk index ID, character size, and markdown heading hierarchy (metadata). Use this as a Table of Contents to locate sections of interest.',
        parameters: z.object({}),
        execute: async () => {
          return chunks.map((c, idx) => ({
            id: idx + 1,
            size: c.pageContent.length,
            headings: c.metadata,
          }))
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
          const headings: string[] = []
          if (chunk.metadata) {
            if (chunk.metadata.h1)
              headings.push(chunk.metadata.h1)
            if (chunk.metadata.h2)
              headings.push(chunk.metadata.h2)
            if (chunk.metadata.h3)
              headings.push(chunk.metadata.h3)
            if (chunk.metadata.h4)
              headings.push(chunk.metadata.h4)
          }
          return {
            chunkId,
            headings: headings.join(' > '),
            content: chunk.pageContent,
          }
        },
      } as any),
      searchChunks: tool({
        description: 'Search all chunks in the document for specific keywords or search terms. Returns matching chunk IDs and small matching context snippets.',
        parameters: z.object({
          query: z.string().describe('The keyword or search phrase to search for.'),
        }),
        execute: async ({ query }: { query: string }) => {
          const results: Array<{ chunkId: number, headings: any, snippet: string }> = []
          const lowercaseQuery = query.toLowerCase()
          for (let i = 0; i < chunks.length; i++) {
            const chunkText = chunks[i].pageContent
            const idx = chunkText.toLowerCase().indexOf(lowercaseQuery)
            if (idx !== -1) {
              const start = Math.max(0, idx - 60)
              const end = Math.min(chunkText.length, idx + lowercaseQuery.length + 60)
              const snippet = `...${chunkText.slice(start, end).replace(/\n/g, ' ')}...`
              results.push({
                chunkId: i + 1,
                headings: chunks[i].metadata,
                snippet,
              })
            }
          }
          return results.slice(0, 10) // Limit to top 10 matches to avoid token explosion
        },
      } as any),
      submitExtraction: tool({
        description: 'Submit the final extracted JSON object conforming to the schema definition. Call this ONLY after you have gathered all necessary information.',
        parameters: z.object({
          data: z.any().describe('The extracted JSON object conforming to the target schema.'),
        }),
        execute: async ({ data }: { data: any }) => {
          finalExtractedData = data
          return { status: 'success', message: 'Data submitted successfully. The extraction is now complete.' }
        },
      } as any),
    }

    const outputSchema = schemaToExtractionOutputSchema(schema)

    const systemPrompt = `You are a precise data extraction agent. Your goal is to extract structured information from a document to populate the target JSON schema.
    
Target JSON Schema structure to populate:
${JSON.stringify(outputSchema, null, 2)}

You are equipped with tools to browse the document dynamically:
1. First, call listChunks to understand the document layout and what sections exist.
2. Based on the schema fields, call readChunk or searchChunks to locate and read relevant content.
3. You can make multiple tool calls. Do not guess. Check the text carefully.
4. Once you have located and read all the necessary information, call the submitExtraction tool with the fully extracted JSON object.
5. After calling submitExtraction, you should stop.

CRITICAL RULES:
1. Extract data strictly conforming to the types and properties of the Target JSON Schema.
2. If a field's value cannot be found in the document after thorough search, set it to null.
3. Do not invent any values.
4. Call submitExtraction exactly once with the final JSON result.`

    const timeoutMs = (config.provider.timeout ?? 300) * 1000

    const agentOpts: any = {
      model: provider.chatModel(selected.name),
      system: systemPrompt,
      prompt: 'Please start by listing the chunks to understand the document structure, then gather the required facts and submit the final JSON extraction.',
      tools,
      maxSteps: 12, // allow the agent to reason/act up to 12 times
      abortSignal: AbortSignal.timeout(timeoutMs),
      experimental_telemetry: { isEnabled: useTelemetry },
      onStepFinish({ text, toolCalls }: any) {
        if (onAgentStep) {
          onAgentStep({ thought: text, toolCalls })
        }
      },
    }

    const result = await generateText(agentOpts)

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
    const validation = validateExtractedData(schema, finalExtractedData)
    if (!validation.success) {
      // Perform a single reflection/correction step if validation fails
      const correctionSystemPrompt = `You are a precise data correction assistant. Your task is to correct validation errors in a previously generated JSON object to make it comply with the JSON Schema.
      
JSON Schema Definition:
${JSON.stringify(outputSchema, null, 2)}

Validation Errors:
${validation.error}

Original Incorrect JSON:
${JSON.stringify(finalExtractedData, null, 2)}

Please output the corrected JSON object. Return ONLY the corrected JSON object, with no markdown tags or explanations.`

      const correctionOpts: any = {
        model: provider.chatModel(selected.name),
        system: correctionSystemPrompt,
        prompt: 'Please correct the JSON output now.',
        abortSignal: AbortSignal.timeout(timeoutMs),
        experimental_telemetry: { isEnabled: useTelemetry },
      }

      const correctionResult = await generateText(correctionOpts)

      const correctedData = safeParseJSON(correctionResult.text)
      const secondValidation = validateExtractedData(schema, correctedData)
      if (!secondValidation.success) {
        return { success: false, error: `Agent output validation failed: ${secondValidation.error}` }
      }
      finalExtractedData = correctedData
    }

    // Write final output to disk
    const outputDir = path.resolve(aiexDir, config.extraction?.outputDir?.replace('.aiex/', '') ?? 'extracted')
    await fs.mkdir(outputDir, { recursive: true })
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const outputFileName = `${schema.table.name}-${timestamp}.json`
    const outputPath = path.join(outputDir, outputFileName)
    await writeJsonFile(outputPath, finalExtractedData, { spaces: 2, EOL: '\n' })

    // Token usage accumulation
    let totalPromptTokens = 0
    let totalCompletionTokens = 0
    if (result.usage) {
      totalPromptTokens = result.usage.inputTokens ?? 0
      totalCompletionTokens = result.usage.outputTokens ?? 0
    }

    return {
      success: true,
      outputPath,
      data: finalExtractedData,
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
