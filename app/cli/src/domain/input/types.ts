import type { ExtractionQualityMetrics } from '@/domain/extraction/quality'

export type InputFileKind = 'pdf' | 'image' | 'text' | 'unsupported'

export interface InputFileKindResult {
  kind: InputFileKind
  mime?: string
}

export type InputHandler = 'text' | 'image_vision' | 'image_local_ocr' | 'pdf_converter'

export interface InputProcessingInfo {
  kind: 'pdf' | 'image' | 'text'
  mime?: string
  handler: InputHandler
  converter?: string
}

export interface ExtractFileInput {
  text: string
  filePath?: string
  inputProcessing: InputProcessingInfo
  quality: ExtractionQualityMetrics
}
