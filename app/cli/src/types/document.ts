export interface ExtractFileInput {
  text: string
}

export interface PdfConversionResult {
  text: string
  pageCount: number
  metadata?: Record<string, string>
}

export interface PdfConverter {
  readonly name: string
  convert: (input: Uint8Array, filePath?: string) => Promise<PdfConversionResult>
}

type LocalOcr = typeof import('@napi-rs/system-ocr')

export interface ImageOcrRuntime {
  platform: NodeJS.Platform
  loadLocalOcr: () => Promise<LocalOcr>
}

export interface ImageOcrTextResult {
  text: string
  confidence: number
}

export interface ImageOcrSelfCheckResult {
  platformSupported: boolean
  dependencyLoaded: boolean
  ocrOk: boolean | null
  imagePath?: string
  recognizedText?: string
  confidence?: number
  error?: string
}
