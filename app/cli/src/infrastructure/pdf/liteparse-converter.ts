import type { PdfConversionResult, PdfConverter } from './types'
import type { LiteparsePdfConverterConfig } from '@/domain/ai/types'
import { DEFAULT_LITEPARSE_CONFIG } from '@/domain/ai/types'

interface LiteParseTextItem {
  text?: string
  x?: number
  y?: number
  width?: number
  height?: number
}

interface LiteParsePage {
  pageNum?: number
  text?: string
  textItems?: LiteParseTextItem[]
}

interface LiteParseResult {
  text?: string
  pages?: LiteParsePage[]
}

interface LiteParseInstance {
  parse: (input: string | Uint8Array) => Promise<LiteParseResult>
}

interface LiteParseConstructor {
  new (options?: {
    ocrLanguage?: string
    ocrEnabled?: boolean
    ocrServerUrl?: string
    tessdataPath?: string
    quiet?: boolean
  }): LiteParseInstance
}

interface LiteParseModule {
  LiteParse: LiteParseConstructor
}

const TESSERACT_FAILURE_RE = /tesseract|tessdata|traineddata|language/i

function textFromPages(pages: LiteParsePage[] = []): string {
  return pages
    .map((page) => {
      if (typeof page.text === 'string')
        return page.text
      return page.textItems?.map(item => item.text).filter(Boolean).join('\n') ?? ''
    })
    .filter(Boolean)
    .join('\n\n')
}

function hasBoundingBoxes(pages: LiteParsePage[] = []): boolean {
  return pages.some(page => page.textItems?.some(item =>
    typeof item.x === 'number'
    && typeof item.y === 'number'
    && typeof item.width === 'number'
    && typeof item.height === 'number',
  ))
}

async function loadLiteParse(): Promise<LiteParseConstructor> {
  try {
    const mod = await import('@llamaindex/liteparse') as LiteParseModule
    return mod.LiteParse
  }
  catch (error) {
    const details = error instanceof Error ? error.message : String(error)
    throw new Error(
      `LiteParse is selected but @llamaindex/liteparse is not available. `
      + `Install optional dependencies or switch the PDF converter to unpdf, mineru, mineru_api, or external. ${details}`,
    )
  }
}

function formatLiteparseError(error: unknown, config: LiteparsePdfConverterConfig): Error {
  const message = error instanceof Error ? error.message : String(error)
  if (!config.ocrEnabled)
    return new Error(message)

  const tesseractFailure = TESSERACT_FAILURE_RE.test(message)
  if (!tesseractFailure)
    return new Error(message)

  return new Error(
    `LiteParse OCR is enabled but Tesseract language data could not be loaded. `
    + `Install the traineddata file for "${config.ocrLanguage ?? DEFAULT_LITEPARSE_CONFIG.ocrLanguage}" `
    + `and set pdf.liteparse.tessdataPath to the directory that contains it, `
    + `or disable pdf.liteparse.ocrEnabled. Original error: ${message}`,
  )
}

export class LiteparsePdfConverter implements PdfConverter {
  readonly name = 'liteparse'

  constructor(private readonly config: LiteparsePdfConverterConfig = DEFAULT_LITEPARSE_CONFIG) {}

  async convert(input: Uint8Array, filePath?: string): Promise<PdfConversionResult> {
    const LiteParse = await loadLiteParse()
    const config = {
      ...DEFAULT_LITEPARSE_CONFIG,
      ...this.config,
    }
    const parser = new LiteParse({
      ocrEnabled: config.ocrEnabled,
      ocrLanguage: config.ocrLanguage,
      ocrServerUrl: config.ocrServerUrl,
      tessdataPath: config.tessdataPath,
      quiet: true,
    })
    const result = await parser.parse(filePath ?? input).catch((error: unknown) => {
      throw formatLiteparseError(error, config)
    })
    const pages = Array.isArray(result.pages) ? result.pages : []
    const text = typeof result.text === 'string' ? result.text : textFromPages(pages)

    return {
      text,
      pageCount: pages.length,
      metadata: {
        converter: this.name,
        ocrEnabled: String(config.ocrEnabled ?? false),
        ...(config.ocrLanguage ? { ocrLanguage: config.ocrLanguage } : {}),
        hasBoundingBoxes: String(hasBoundingBoxes(pages)),
      },
    }
  }
}
