import type { PdfConversionResult, PdfConverter } from './types'
import { Buffer } from 'node:buffer'
import { extractText, getMeta } from 'unpdf'

export class UnpdfConverter implements PdfConverter {
  readonly name = 'unpdf'

  async convert(input: Uint8Array): Promise<PdfConversionResult> {
    const data = Buffer.isBuffer(input) ? new Uint8Array(input) : input
    const [textResult, meta] = await Promise.all([
      extractText(data, { mergePages: true }),
      getMeta(data).catch(() => null),
    ])

    return {
      text: textResult.text,
      pageCount: textResult.totalPages,
      metadata: {
        converter: this.name,
        ...(meta?.info
          ? Object.fromEntries(
              Object.entries(meta.info).map(([k, v]) => [k, String(v)]),
            )
          : {}),
      },
    }
  }
}
