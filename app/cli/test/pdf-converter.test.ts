import type { PdfConversionResult, PdfConverter } from '@/core/pdf-converter'
import { Buffer } from 'node:buffer'
import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createPdfConverter, registerPdfConverter, UnpdfConverter } from '@/core/pdf-converter'

const DEMO_PDF = path.resolve(import.meta.dirname, 'demo.pdf')

async function getPdfBuffer(): Promise<Uint8Array> {
  return await fs.readFile(DEMO_PDF)
}

// ─── type safety ──────────────────────────────────────────────

describe('pdfConversionResult', () => {
  it('satisfies the shape', () => {
    const result: PdfConversionResult = {
      text: 'hello',
      pageCount: 1,
    }
    expect(result.text).toBe('hello')
    expect(result.pageCount).toBe(1)
    expect(result.metadata).toBeUndefined()
  })

  it('supports optional metadata', () => {
    const result: PdfConversionResult = {
      text: 'hello',
      pageCount: 2,
      metadata: { Author: 'Test', Title: 'Doc' },
    }
    expect(result.metadata!.Author).toBe('Test')
  })
})

describe('pdfConverter interface', () => {
  it('enforces the correct shape', () => {
    const converter: PdfConverter = {
      name: 'test',
      convert: async (_input: Uint8Array) => ({
        text: 'dummy',
        pageCount: 1,
      }),
    }
    expect(converter.name).toBe('test')
  })
})

// ─── UnpdfConverter ───────────────────────────────────────────

describe('unpdfConverter', () => {
  it('has the correct name', () => {
    const converter = new UnpdfConverter()
    expect(converter.name).toBe('unpdf')
  })

  it('extracts text from demo.pdf', async () => {
    const buffer = await getPdfBuffer()
    const converter = new UnpdfConverter()
    const result = await converter.convert(buffer)

    expect(result.text).toBeTruthy()
    expect(typeof result.text).toBe('string')
    expect(result.text.length).toBeGreaterThan(50)
    expect(result.pageCount).toBeGreaterThanOrEqual(1)
  })

  it('extracts meaningful content from demo.pdf', async () => {
    const buffer = await getPdfBuffer()
    const converter = new UnpdfConverter()
    const result = await converter.convert(buffer)

    expect(result.text).toMatch(/flow duration curves/i)
    expect(result.text).toMatch(/Lane/i)
    expect(result.text).toMatch(/Journal of Hydrology/i)
    expect(result.pageCount).toBeGreaterThanOrEqual(1)
  })

  it('extracts PDF metadata when available', async () => {
    const buffer = await getPdfBuffer()
    const converter = new UnpdfConverter()
    const result = await converter.convert(buffer)

    if (result.metadata) {
      expect(typeof result.metadata).toBe('object')
      for (const value of Object.values(result.metadata)) {
        expect(typeof value).toBe('string')
      }
    }
  })

  it('handles empty buffer gracefully', async () => {
    const converter = new UnpdfConverter()
    const buffer = new Uint8Array(0)
    await expect(converter.convert(buffer)).rejects.toThrow()
  })

  it('handles invalid PDF gracefully', async () => {
    const converter = new UnpdfConverter()
    const buffer = new Uint8Array([1, 2, 3, 4, 5])
    await expect(converter.convert(buffer)).rejects.toThrow()
  })

  it('accepts Buffer input (Buffer extends Uint8Array)', async () => {
    const buffer = Buffer.from(await fs.readFile(DEMO_PDF))
    const converter = new UnpdfConverter()
    const result = await converter.convert(buffer)
    expect(result.text.length).toBeGreaterThan(50)
  })
})

// ─── Factory ──────────────────────────────────────────────────

describe('createPdfConverter', () => {
  it('returns an UnpdfConverter by default', () => {
    const converter = createPdfConverter()
    expect(converter).toBeInstanceOf(UnpdfConverter)
    expect(converter.name).toBe('unpdf')
  })

  it('returns an UnpdfConverter when type is "unpdf"', () => {
    const converter = createPdfConverter('unpdf')
    expect(converter).toBeInstanceOf(UnpdfConverter)
  })

  it('returns the singleton instance on repeated calls', () => {
    const a = createPdfConverter()
    const b = createPdfConverter()
    expect(a).toBe(b)
  })

  it('returns the singleton instance for explicit type', () => {
    const a = createPdfConverter('unpdf')
    const b = createPdfConverter('unpdf')
    expect(a).toBe(b)
  })
})

describe('registerPdfConverter', () => {
  it('allows registering and retrieving a custom converter', () => {
    const custom: PdfConverter = {
      name: 'custom',
      convert: async () => ({ text: 'custom text', pageCount: 99 }),
    }
    registerPdfConverter('custom', custom)

    const converter = createPdfConverter('custom' as any)

    expect(converter.name).toBe('custom')
  })

  it('allows overriding an existing type', () => {
    const override: PdfConverter = {
      name: 'override-unpdf',
      convert: async () => ({ text: 'overridden', pageCount: 0 }),
    }
    registerPdfConverter('unpdf', override)

    const converter = createPdfConverter('unpdf')
    expect(converter.name).toBe('override-unpdf')

    // Restore the original UnpdfConverter for subsequent tests
    registerPdfConverter('unpdf', new UnpdfConverter())
    const restored = createPdfConverter('unpdf')
    expect(restored.name).toBe('unpdf')
  })
})
