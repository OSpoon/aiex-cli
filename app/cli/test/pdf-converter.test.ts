import type { PdfConversionResult, PdfConverter } from '@/core/pdf-converter'
import { Buffer } from 'node:buffer'
import fs from 'node:fs/promises'
import path from 'node:path'
import { execa } from 'execa'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPdfConverter, ExternalCommandPdfConverter, registerPdfConverter, UnpdfConverter } from '@/core/pdf-converter'

vi.mock('execa', () => ({
  execa: vi.fn(),
}))

const DEMO_PDF = path.resolve(import.meta.dirname, 'demo.pdf')

async function getPdfBuffer(): Promise<Uint8Array> {
  return await fs.readFile(DEMO_PDF)
}

async function writeMockMarkdown(args: readonly string[], content = '# Converted markdown'): Promise<void> {
  const outputIndex = args.indexOf('-o')
  if (outputIndex < 0)
    throw new Error('missing -o argument')

  const inputIndex = args.indexOf('-p')
  const inputPath = inputIndex >= 0 ? args[inputIndex + 1] : 'input.pdf'
  const basename = path.basename(inputPath, path.extname(inputPath))
  const outputDir = args[outputIndex + 1]
  await fs.mkdir(outputDir, { recursive: true })
  await fs.writeFile(path.join(outputDir, `${basename}.md`), content)
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

// ─── ExternalCommandPdfConverter ──────────────────────────────

describe('externalCommandPdfConverter', () => {
  beforeEach(() => {
    vi.mocked(execa as any).mockReset()
  })

  it('runs command with templated args and reads markdown output', async () => {
    vi.mocked(execa as any).mockImplementation(async (_command: string, args: string[]) => {
      await writeMockMarkdown(args as string[], '# MinerU output')
      return {} as any
    })

    const converter = new ExternalCommandPdfConverter('mineru', {
      command: 'mineru',
      args: ['-p', '{input}', '-o', '{outputDir}'],
      timeout: 600,
    })

    const result = await converter.convert(new Uint8Array([1, 2, 3]), '/tmp/sample.pdf')

    expect(result.text).toBe('# MinerU output')
    expect(result.metadata?.converter).toBe('mineru')
    expect(execa).toHaveBeenCalledWith(
      'mineru',
      ['-p', '/tmp/sample.pdf', '-o', expect.stringContaining('aiex-pdf-')],
      expect.objectContaining({ shell: false, timeout: 600000 }),
    )
  })

  it('supports explicit outputFile template', async () => {
    vi.mocked(execa as any).mockImplementation(async (_command: string, args: string[]) => {
      const outputDir = (args as string[])[(args as string[]).indexOf('--output_dir') + 1]
      await fs.mkdir(outputDir, { recursive: true })
      await fs.writeFile(path.join(outputDir, 'custom.md'), 'custom markdown')
      return {} as any
    })

    const converter = new ExternalCommandPdfConverter('external', {
      command: 'marker_single',
      args: ['{input}', '--output_dir', '{outputDir}'],
      outputFile: '{outputDir}/custom.md',
    })

    const result = await converter.convert(new Uint8Array([1, 2, 3]), '/tmp/source.pdf')

    expect(result.text).toBe('custom markdown')
  })

  it('surfaces command failures with stderr', async () => {
    const error = new Error('failed') as Error & { exitCode: number, stderr: string }
    error.exitCode = 2
    error.stderr = 'mineru failed'
    vi.mocked(execa as any).mockRejectedValue(error)

    const converter = new ExternalCommandPdfConverter('mineru', {
      command: 'mineru',
      args: ['-p', '{input}', '-o', '{outputDir}'],
    })

    await expect(converter.convert(new Uint8Array([1]), '/tmp/bad.pdf')).rejects.toThrow(/mineru failed/)
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

  it('creates a mineru converter from pdf config', () => {
    const converter = createPdfConverter({
      converter: 'mineru',
      mineru: {
        command: 'mineru',
        args: ['-p', '{input}', '-o', '{outputDir}'],
      },
    })
    expect(converter.name).toBe('mineru')
  })

  it('rejects external converter without command config', () => {
    expect(() => createPdfConverter({ converter: 'external' })).toThrow(/no external command/i)
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
