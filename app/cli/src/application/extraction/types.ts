import type { AIConfig, AIModelConfig } from '@/core/ai-extraction/types'
import type { createMigrationConfig } from '@/core/schema-sqlite'
import type { ExtractionFailureStage, FieldEvidence } from '@/domain/audit/types'
import type { ExtractionQualityMetrics } from '@/domain/extraction/quality'
import type { InputProcessingInfo } from '@/domain/input/types'

export interface ExtractFileInput {
  text: string
  filePath?: string
  inputProcessing?: InputProcessingInfo
  quality?: ExtractionQualityMetrics
}

export interface ExtractResult {
  success: boolean
  error?: string
  outputPath?: string
  data?: unknown
  tablesInserted?: Array<{ table: string, rowId: number }>
  notionPages?: Array<{ databaseId: string, pageId: string }>
  tokensUsed?: {
    prompt: number
    completion: number
    total: number
  }
  quality?: ExtractionQualityMetrics
  failureStage?: ExtractionFailureStage
  evidence?: Record<string, FieldEvidence>
}

export interface BatchExtractionResult {
  ok: boolean
  successCount: number
  failCount: number
  error?: string
}

export interface RunAuditedExtractionOptions {
  aiexDir: string
  config: ReturnType<typeof createMigrationConfig>
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
  tokensUsed?: {
    prompt: number
    completion: number
    total: number
  }
  auditId?: string
  fileHash?: string
  inputProcessing?: InputProcessingInfo
  quality?: ExtractionQualityMetrics
  failureStage?: ExtractionFailureStage
  evidence?: Record<string, FieldEvidence>
}
