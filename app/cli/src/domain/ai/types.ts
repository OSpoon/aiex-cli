export interface AIModelConfig {
  name: string
  capabilities: {
    vision: boolean
    structuredOutput: boolean
    maxTokens?: number
    maxOutputTokens?: number
  }
}

export interface AIProviderConfig {
  baseURL: string
  apiKey: string
  models: AIModelConfig[]
  timeout?: number
}

export interface PromptConfig {
  systemTemplate: string
  userTemplate: string
}

export interface ExtractionConfig {
  outputDir: string
}

export type ImageOcrFallbackMode = 'localAuto'

export interface ImageOcrConfig {
  ocrFallback?: ImageOcrFallbackMode
  ocrLanguages?: string
  ocrMinConfidence?: number
}

export type PdfConverterKind = 'unpdf' | 'liteparse' | 'mineru' | 'mineru_api' | 'external'

export interface MineruApiPdfConverterConfig {
  token: string
  baseURL?: string
  modelVersion?: string
  isOcr?: boolean
  enableFormula?: boolean
  enableTable?: boolean
}

export interface ExternalPdfConverterConfig {
  command: string
  args: string[]
  outputFile?: string
  timeout?: number
  fallbackToUnpdf?: boolean
}

export interface PdfConfig {
  converter: PdfConverterKind
  mineru?: ExternalPdfConverterConfig
  mineruApi?: MineruApiPdfConverterConfig
  external?: ExternalPdfConverterConfig
}

export interface LangfuseConfig {
  publicKey: string
  secretKey: string
  host?: string
}

export interface NotionSchemaConfig {
  databaseId: string
  titleProperty?: string
  fieldMap?: Record<string, string>
}

export interface NotionConfig {
  enabled: boolean
  token: string
  schemas: Record<string, NotionSchemaConfig>
}

export interface WebhookConfig {
  enabled: boolean
  url: string
  secret?: string
}

export interface AIConfig {
  provider: AIProviderConfig
  prompt: PromptConfig
  extraction: ExtractionConfig
  image?: ImageOcrConfig
  pdf?: PdfConfig
  langfuse?: LangfuseConfig
  notion?: NotionConfig
  webhook?: WebhookConfig
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
  quality?: import('@/domain/extraction/quality').ExtractionQualityMetrics
  evidence?: Record<string, import('@/domain/audit/types').FieldEvidence>
}

export const DEFAULT_MODELS: AIModelConfig[] = [
  { name: 'qwen-plus', capabilities: { vision: false, structuredOutput: true } },
  { name: 'qwen-vl-plus', capabilities: { vision: true, structuredOutput: true } },
]

export const DEFAULT_PROVIDER_CONFIG: AIProviderConfig = {
  baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  apiKey: '',
  models: [...DEFAULT_MODELS],
  timeout: 300,
}

export const DEFAULT_PROMPT_CONFIG: PromptConfig = {
  systemTemplate: `You are a professional data extraction assistant. Your task is to extract structured data from text and return a JSON object based on the data structure definition provided below.

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

export const DEFAULT_IMAGE_OCR_CONFIG: ImageOcrConfig = {
  ocrFallback: 'localAuto',
  ocrLanguages: 'en-US, zh-Hans',
  ocrMinConfidence: 0,
}

export const DEFAULT_MINERU_CONFIG: ExternalPdfConverterConfig = {
  command: 'mineru',
  args: ['-p', '{input}', '-o', '{outputDir}'],
  timeout: 600,
  fallbackToUnpdf: true,
}

export const DEFAULT_MINERU_API_CONFIG: MineruApiPdfConverterConfig = {
  token: '',
  baseURL: 'https://mineru.net/api/v4',
  modelVersion: 'vlm',
  isOcr: true,
  enableFormula: true,
  enableTable: true,
}

export const DEFAULT_PDF_CONFIG: PdfConfig = {
  converter: 'unpdf',
  mineru: DEFAULT_MINERU_CONFIG,
  mineruApi: DEFAULT_MINERU_API_CONFIG,
}

export const DEFAULT_AI_CONFIG: AIConfig = {
  provider: DEFAULT_PROVIDER_CONFIG,
  prompt: DEFAULT_PROMPT_CONFIG,
  extraction: DEFAULT_EXTRACTION_CONFIG,
  pdf: DEFAULT_PDF_CONFIG,
  webhook: {
    enabled: false,
    url: '',
    secret: '',
  },
}
