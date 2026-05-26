import type { PdfConfig, PdfConversionResult, PdfConverter } from '@/types'
import { consola } from 'consola'
import { DEFAULT_MARKER_CONFIG, DEFAULT_MARKITDOWN_CONFIG, DEFAULT_MINERU_API_CONFIG, DEFAULT_MINERU_CONFIG } from '@/core/ai-extraction/types'
import { t } from '@/locales'
import { ExternalCommandPdfConverter } from './external'
import { MineruApiPdfConverter } from './mineru-api'
import { UnpdfConverter } from './unpdf'

export type PdfConverterType = 'unpdf' | 'mineru' | 'mineru_api' | 'markitdown' | 'marker' | 'external'

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
    if (config.converter === 'mineru') {
      const mineruConfig = config.mineru ?? DEFAULT_MINERU_CONFIG
      return withFallback(new ExternalCommandPdfConverter('mineru', mineruConfig), mineruConfig)
    }

    if (config.converter === 'mineru_api') {
      const mineruApiConfig = config.mineruApi ?? DEFAULT_MINERU_API_CONFIG
      return new MineruApiPdfConverter(mineruApiConfig)
    }

    if (config.converter === 'markitdown') {
      const markitdownConfig = config.markitdown ?? DEFAULT_MARKITDOWN_CONFIG
      return withFallback(new ExternalCommandPdfConverter('markitdown', markitdownConfig), markitdownConfig)
    }

    if (config.converter === 'marker') {
      const markerConfig = config.marker ?? DEFAULT_MARKER_CONFIG
      return withFallback(new ExternalCommandPdfConverter('marker', markerConfig), markerConfig)
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
    if (key !== 'unpdf')
      throw new Error(t('errors.pdf.converterRequiresConfig', { name: key }))
    instance = new UnpdfConverter()
    registry.set(key, instance)
  }
  return instance
}

export function registerPdfConverter(type: string, converter: PdfConverter): void {
  registry.set(type as PdfConverterType, converter)
}
