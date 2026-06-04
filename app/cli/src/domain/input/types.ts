import type { ExtractionQualityMetrics } from '@/domain/extraction/quality'

export type InputFileKind = 'pdf' | 'image' | 'text' | 'unsupported'

export interface InputFileKindResult {
  kind: InputFileKind
  mime?: string
}

export type InputHandler = 'text' | 'image_vision' | 'image_local_ocr' | 'pdf_converter'
export type InputProcessingStatus = 'parsed' | 'partially_parsed' | 'failed'

export interface InputProcessingInfo {
  kind: 'pdf' | 'image' | 'text'
  mime?: string
  handler: InputHandler
  status?: InputProcessingStatus
  parser?: string
  converter?: string
  warnings?: string[]
  diagnostics?: Record<string, string | number | boolean>
}

export interface ExtractFileInput {
  text: string
  filePath?: string
  inputProcessing: InputProcessingInfo
  quality: ExtractionQualityMetrics
}
