import type { ExtractionQualityMetrics } from '@/domain/extraction/quality'
import type { InputProcessingInfo } from '@/domain/input/types'

export type ExtractionAuditStatus = 'running' | 'succeeded' | 'failed' | 'stale'

export type ExtractionFailureStage
  = | 'input_detection'
    | 'file_conversion'
    | 'ocr'
    | 'ai_extraction'
    | 'db_insert'
    | 'integration'

export interface FieldEvidence {
  quote: string
  start: number
  end: number
  verified: true
  matchMethod: 'exact_unique'
}

export interface ExtractionAuditRecord {
  id: string
  status: ExtractionAuditStatus
  schemaName: string
  modelName?: string
  source: {
    type: 'text' | 'file'
    text?: string
    filePath?: string
    fileName?: string
    fileHash?: string
  }
  retryOf?: string
  outputName?: string
  outputPath?: string
  tablesInserted?: Array<{ table: string, rowId: number }>
  notionPages?: Array<{ databaseId: string, pageId: string }>
  tokensUsed?: {
    prompt: number
    completion: number
    total: number
  }
  inputProcessing?: InputProcessingInfo
  quality?: ExtractionQualityMetrics
  failureStage?: ExtractionFailureStage
  evidence?: Record<string, FieldEvidence>
  error?: string
  createdAt: string
  updatedAt: string
}

export interface CreateExtractionAuditInput {
  schemaName: string
  modelName?: string
  source: ExtractionAuditRecord['source']
  retryOf?: string
}
