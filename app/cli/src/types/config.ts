export interface AppConfig {
  name?: string
  version?: string
}

export interface AIModelConfig {
  name: string
  capabilities: {
    vision: boolean
    structuredOutput: boolean
    supportsTools?: boolean
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
  mode?: 'pipeline'
  concurrency?: number
  overlapSize?: number
  preFiltering?: boolean
  preFilteringLimit?: number
}

export type ImageOcrFallbackMode = 'auto' | 'off' | 'local'

export interface ImageOcrConfig {
  ocrFallback?: ImageOcrFallbackMode
  ocrLanguages?: string
  ocrMinConfidence?: number
}

export type PdfConverterKind = 'unpdf' | 'mineru' | 'mineru_api' | 'markitdown' | 'marker' | 'external'

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
  markitdown?: ExternalPdfConverterConfig
  marker?: ExternalPdfConverterConfig
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

export interface McpServerConfig {
  name: string
  enabled: boolean
  transport: 'stdio' | 'sse' | 'http'
  command?: string
  args?: string[]
  url?: string
  allowedTools?: string[]
}

export interface AgentExtensionsConfig {
  mcp?: {
    servers: McpServerConfig[]
  }
  skills?: {
    enabled?: boolean
    directories?: string[]
  }
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
  agentExtensions?: AgentExtensionsConfig
}

export interface DoctorDiagnostics {
  cli: {
    name: string
    version: string
    executable: string
  }
  runtime: {
    node: string
    platform: string
    arch: string
    shell: string
    packageManager: string
  }
  system: {
    os: string
    cwd: string
  }
  imageOcr: {
    platformSupported: boolean
    dependencyLoaded: boolean
    ocrOk: boolean | null
    imagePath?: string
    recognizedText?: string
    confidence?: number
    error?: string
  }
  config: {
    path: string
    keys: string[]
  }
  project: {
    aiexDir: string
    dirExists: boolean
    schemaCount: number
    schemaFiles: string[]
    aiConfig: boolean
    aiApiKeySet: boolean
    aiModelCount: number
    aiModels: string[]
    aiProvider: string | null
    aiConnectionOk: boolean | null
    hasDatabase: boolean
    migrationCount: number
    errors: string[]
  }
}
