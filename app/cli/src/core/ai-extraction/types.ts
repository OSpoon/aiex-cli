export interface AIModelConfig {
  name: string
  capabilities: {
    vision: boolean
    structuredOutput: boolean
  }
}

export interface AIProviderConfig {
  baseURL: string
  apiKey: string
  models: AIModelConfig[]
}

export interface PromptConfig {
  systemTemplate: string
  userTemplate: string
}

export interface ExtractionConfig {
  outputDir: string
}

export interface AIConfig {
  provider: AIProviderConfig
  prompt: PromptConfig
  extraction: ExtractionConfig
}

export const PLACEHOLDER_SCHEMA = '{schema}'
export const PLACEHOLDER_TEXT = '{text}'

export interface ExtractionResult {
  success: boolean
  outputPath?: string
  data?: unknown
  error?: string
  tokensUsed?: {
    prompt: number
    completion: number
    total: number
  }
}

export const DEFAULT_MODELS: AIModelConfig[] = [
  { name: 'qwen-plus', capabilities: { vision: false, structuredOutput: true } },
  { name: 'qwen-vl-plus', capabilities: { vision: true, structuredOutput: true } },
]

export const DEFAULT_PROVIDER_CONFIG: AIProviderConfig = {
  baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  apiKey: '',
  models: [...DEFAULT_MODELS],
}

export const DEFAULT_PROMPT_CONFIG: PromptConfig = {
  systemTemplate: `You are a professional data extraction assistant. Your task is to extract structured data from text based on the data structure definition provided below.

{schema}

Extraction requirements:
1. Extract strictly according to the field names and types defined in the structure
2. If the text lacks information for a field, set that field to null
3. Do not add fields that do not exist in the structure definition
4. Maintain data accuracy and completeness`,
  userTemplate: `Please extract data from the following text:
{text}`,
}

export const DEFAULT_EXTRACTION_CONFIG: ExtractionConfig = {
  outputDir: '.aiex/extracted',
}

export const DEFAULT_AI_CONFIG: AIConfig = {
  provider: DEFAULT_PROVIDER_CONFIG,
  prompt: DEFAULT_PROMPT_CONFIG,
  extraction: DEFAULT_EXTRACTION_CONFIG,
}
