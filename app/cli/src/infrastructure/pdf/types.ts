export interface PdfConversionResult {
  text: string
  pageCount: number
  metadata?: Record<string, string>
}

export interface PdfConverter {
  readonly name: string
  convert: (input: Uint8Array, filePath?: string) => Promise<PdfConversionResult>
}
