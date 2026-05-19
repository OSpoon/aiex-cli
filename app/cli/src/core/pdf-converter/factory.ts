import type { PdfConversionResult, PdfConverter } from './types'
import type { ExternalPdfConverterConfig, PdfConfig } from '@/core/ai-extraction/types'
import { consola } from 'consola'
import { DEFAULT_MINERU_CONFIG } from '@/core/ai-extraction/types'
import { ExternalCommandPdfConverter } from './external'
import { UnpdfConverter } from './unpdf'

export type PdfConverterType = 'unpdf' | 'mineru' | 'external'

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
      consola.warn(`${this.primary.name} failed: ${err instanceof Error ? err.message : String(err)}`)
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

function withFallback(converter: PdfConverter, config: ExternalPdfConverterConfig): PdfConverter {
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

    if (config.converter === 'external') {
      if (!config.external)
        throw new Error('External PDF converter is selected but no external command is configured.')
      return withFallback(new ExternalCommandPdfConverter('external', config.external), config.external)
    }
  }

  const key = typeof config === 'string' ? config : 'unpdf'
  let instance = registry.get(key)
  if (!instance) {
    if (key !== 'unpdf')
      throw new Error(`PDF converter "${key}" requires configuration.`)
    instance = new UnpdfConverter()
    registry.set(key, instance)
  }
  return instance
}

export function registerPdfConverter(type: string, converter: PdfConverter): void {
  registry.set(type as PdfConverterType, converter)
}
