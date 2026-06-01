import type { PdfConversionResult, PdfConverter } from './types'
import type { PdfConfig } from '@/domain/ai/types'
import { consola } from 'consola'
import { DEFAULT_MINERU_API_CONFIG, DEFAULT_MINERU_CONFIG } from '@/domain/ai/types'
import { t } from '@/locales'
import { ExternalCommandPdfConverter } from './external-converter'
import { LiteparsePdfConverter } from './liteparse-converter'
import { MineruApiPdfConverter } from './mineru-api-converter'
import { UnpdfConverter } from './unpdf-converter'

export type PdfConverterType = 'unpdf' | 'liteparse' | 'mineru' | 'mineru_api' | 'external'

const registry = new Map<PdfConverterType, PdfConverter>()

class FallbackPdfConverter implements PdfConverter {
  readonly name: string

  constructor(
    private readonly primary: PdfConverter,
    private readonly fallback: PdfConverter,
  ) {
    this.name = primary.name
  }

  async convert(input: Uint8Array, filePath?: string): Promise<PdfConversionResult> {
    try {
      return await this.primary.convert(input, filePath)
    }
    catch (err) {
      consola.warn(t('command.extract.file.errorProcessing', { name: this.primary.name, error: err instanceof Error ? err.message : String(err) }))
      consola.info(`Falling back to ${this.fallback.name}`)
      const result = await this.fallback.convert(input, filePath)
      return {
        ...result,
        metadata: {
          ...result.metadata,
          fallback: 'true',
        },
      }
    }
  }
}

function withFallback(converter: PdfConverter, config: { fallbackToUnpdf?: boolean }): PdfConverter {
  if (!config.fallbackToUnpdf)
    return converter
  return new FallbackPdfConverter(converter, new UnpdfConverter())
}

export function createPdfConverter(config?: PdfConverterType | PdfConfig): PdfConverter {
  if (typeof config === 'object') {
    if (config.converter === 'liteparse')
      return new LiteparsePdfConverter()

    if (config.converter === 'mineru') {
      const mineruConfig = config.mineru ?? DEFAULT_MINERU_CONFIG
      return withFallback(new ExternalCommandPdfConverter('mineru', mineruConfig), mineruConfig)
    }

    if (config.converter === 'mineru_api') {
      const mineruApiConfig = config.mineruApi ?? DEFAULT_MINERU_API_CONFIG
      return new MineruApiPdfConverter(mineruApiConfig)
    }

    if (config.converter === 'external') {
      if (!config.external)
        throw new Error(t('errors.pdf.externalNotConfigured'))
      return new ExternalCommandPdfConverter('external', config.external)
    }
  }

  const key = typeof config === 'string' ? config : 'unpdf'
  let instance = registry.get(key)
  if (!instance) {
    if (key === 'liteparse')
      instance = new LiteparsePdfConverter()
    else if (key === 'unpdf')
      instance = new UnpdfConverter()
    else
      throw new Error(t('errors.pdf.converterRequiresConfig', { name: key }))
    registry.set(key, instance)
  }
  return instance
}

export function registerPdfConverter(type: string, converter: PdfConverter): void {
  registry.set(type as PdfConverterType, converter)
}
