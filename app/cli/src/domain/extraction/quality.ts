export interface ExtractionQualityMetrics {
  input?: {
    kind: 'pdf' | 'image' | 'text'
    textLength?: number
    emptyText?: boolean
    pdf?: {
      pageCount: number
      textLength: number
      emptyText: boolean
      fallbackUsed: boolean
      converter: string
    }
    ocr?: {
      confidence: number
      textLength: number
      platform: string
    }
  }
  ai?: {
    validationPassed: boolean
    attempts: number
    selfCorrectionCount: number
    apiRetryCount: number
    missingFields?: string[]
    missingFieldRate?: number
    validationError?: string
  }
}
