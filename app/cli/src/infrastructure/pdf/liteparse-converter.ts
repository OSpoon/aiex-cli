import type { PdfConversionResult, PdfConverter } from './types'

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
    ocrEnabled?: boolean
    quiet?: boolean
  }): LiteParseInstance
}

interface LiteParseModule {
  LiteParse: LiteParseConstructor
}

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

export class LiteparsePdfConverter implements PdfConverter {
  readonly name = 'liteparse'

  async convert(input: Uint8Array, filePath?: string): Promise<PdfConversionResult> {
    const LiteParse = await loadLiteParse()
    const parser = new LiteParse({
      ocrEnabled: false,
      quiet: true,
    })
    const result = await parser.parse(filePath ?? input)
    const pages = Array.isArray(result.pages) ? result.pages : []
    const text = typeof result.text === 'string' ? result.text : textFromPages(pages)

    return {
      text,
      pageCount: pages.length,
      metadata: {
        converter: this.name,
        hasBoundingBoxes: String(hasBoundingBoxes(pages)),
      },
    }
  }
}
