import type { PdfConverter } from './types'
import { UnpdfConverter } from './unpdf'

export type PdfConverterType = 'unpdf'

const registry = new Map<PdfConverterType, PdfConverter>()

export function createPdfConverter(type?: PdfConverterType): PdfConverter {
  const key = type ?? 'unpdf'
  let instance = registry.get(key)
  if (!instance) {
    instance = new UnpdfConverter()
    registry.set(key, instance)
  }
  return instance
}

export function registerPdfConverter(type: string, converter: PdfConverter): void {
  registry.set(type as PdfConverterType, converter)
}
