import type { AIConfig, AIModelConfig } from './config'
import type { MigrationConfig } from './database'

export interface ExtractionResult {
  success: boolean
  outputPath?: string
  data?: unknown
  error?: string
  evidenceSummary?: EvidenceSummary
  tokensUsed?: {
    prompt: number
    completion: number
    total: number
  }
}

export interface ExtractResult {
  success: boolean
  error?: string
  outputPath?: string
  data?: unknown
  tablesInserted?: Array<{ table: string, rowId: number }>
  notionPages?: Array<{ databaseId: string, pageId: string }>
  evidenceSummary?: EvidenceSummary
  tokensUsed?: {
    prompt: number
    completion: number
    total: number
  }
}

export interface BatchExtractionResult {
  ok: boolean
  successCount: number
  failCount: number
  error?: string
}

export interface InsertResult {
  success: boolean
  tablesInserted: Array<{ table: string, rowId: number }>
  error?: string
}

export interface RegistryEntry {
  vision: boolean
  structuredOutput: boolean
  maxTokens?: number
  maxOutputTokens?: number
}

export interface ModelCapabilities {
  structuredOutput: boolean
  vision: boolean
  maxTokens?: number
  maxOutputTokens?: number
}

export interface SelectModelInput {
  models: AIModelConfig[]
  isImage: boolean
  fileName?: string
  inputTokens?: number
  outputTokens?: number
}

export interface SelectedModel {
  name: string
  capabilities: AIModelConfig['capabilities']
}

export interface PromptSnapshot {
  system: string
  user: string
}

export interface ExportColumnInfo {
  name: string
  type?: string
}

export interface RunAuditedExtractionOptions {
  aiexDir: string
  config: MigrationConfig
  aiConfig: AIConfig
  schemaName: string
  source:
    | { type: 'file', filePath: string }
    | { type: 'text', text: string }
  modelOverride?: AIModelConfig
  retryOf?: string
  insert?: boolean
  force?: boolean
  quiet?: boolean
}

export interface RunAuditedExtractionResult {
  success: boolean
  skipped?: boolean
  error?: string
  outputPath?: string
  outputName?: string
  tablesInserted?: Array<{ table: string, rowId: number }>
  notionPages?: Array<{ databaseId: string, pageId: string }>
  evidenceSummary?: EvidenceSummary
  tokensUsed?: {
    prompt: number
    completion: number
    total: number
  }
  auditId?: string
  fileHash?: string
}

export interface EvidenceSummary {
  path?: string
  fieldCount: number
  evidenceCount: number
  foundCount: number
  missingCount: number
  inferredCount: number
  issueCount: number
}
