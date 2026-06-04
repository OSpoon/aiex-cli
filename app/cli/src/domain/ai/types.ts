import { DEFAULT_PROMPT_CONFIG } from './prompts'

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

export const PDF_CONVERTER_KINDS = ['unpdf', 'liteparse', 'mineru', 'mineru_api', 'external'] as const

export type PdfConverterKind = typeof PDF_CONVERTER_KINDS[number]

export interface MineruApiPdfConverterConfig {
  token: string
  baseURL?: string
  modelVersion?: string
  isOcr?: boolean
  enableFormula?: boolean
  enableTable?: boolean
}

export interface LiteparsePdfConverterConfig {
  ocrEnabled?: boolean
  ocrLanguage?: string
  tessdataPath?: string
  ocrServerUrl?: string
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
  liteparse?: LiteparsePdfConverterConfig
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

export {
  DEFAULT_PROMPT_CONFIG,
  PLACEHOLDER_SCHEMA,
  PLACEHOLDER_TEXT,
} from './prompts'

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

export const DEFAULT_LITEPARSE_CONFIG: LiteparsePdfConverterConfig = {
  ocrEnabled: false,
  ocrLanguage: 'eng',
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
  liteparse: DEFAULT_LITEPARSE_CONFIG,
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
