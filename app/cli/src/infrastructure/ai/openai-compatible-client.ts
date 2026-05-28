import type { AIProviderConfig } from '@/domain/ai/types'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'

export const OPENAI_COMPATIBLE_PROVIDER_NAME = 'openai-compatible'

export function createOpenAICompatibleProvider(input: {
  provider: AIProviderConfig
  supportsStructuredOutputs: boolean
}): ReturnType<typeof createOpenAICompatible> {
  return createOpenAICompatible({
    baseURL: input.provider.baseURL,
    name: OPENAI_COMPATIBLE_PROVIDER_NAME,
    apiKey: input.provider.apiKey,
    supportsStructuredOutputs: input.supportsStructuredOutputs,
  })
}
