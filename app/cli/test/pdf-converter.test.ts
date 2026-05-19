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

vi.mock('unpdf', async (importOriginal) => {
  const actual = await importOriginal() as typeof import('unpdf')
  return {
    ...actual,
    getDocumentProxy: vi.fn().mockResolvedValue({ numPages: 5 }),
  }
})

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
      ['-p', '/tmp/sample.pdf', '-o', expect.stringContaining('aiex-mineru-')],
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

  it('formats errors with exit code and signal', async () => {
    const error = new Error('killed') as Error & { exitCode: number, signal: string, stderr: string }
    error.exitCode = 137
    error.signal = 'SIGKILL'
    error.stderr = ''
    vi.mocked(execa as any).mockRejectedValue(error)

    const converter = new ExternalCommandPdfConverter('mineru', {
      command: 'mineru',
      args: ['-p', '{input}', '-o', '{outputDir}'],
    })

    await expect(converter.convert(new Uint8Array([1]), '/tmp/killed.pdf')).rejects.toThrow(/exitCode=137/)
    await expect(converter.convert(new Uint8Array([1]), '/tmp/killed.pdf')).rejects.toThrow(/signal=SIGKILL/)
  })

  it('handles non-Error rejection (string)', async () => {
    vi.mocked(execa as any).mockRejectedValue('something went wrong')

    const converter = new ExternalCommandPdfConverter('mineru', {
      command: 'mineru',
      args: ['-p', '{input}', '-o', '{outputDir}'],
    })

    await expect(converter.convert(new Uint8Array([1]), '/tmp/str.pdf')).rejects.toThrow()
  })

  it('handles non-Error rejection (null)', async () => {
    vi.mocked(execa as any).mockRejectedValue(null)

    const converter = new ExternalCommandPdfConverter('mineru', {
      command: 'mineru',
      args: ['-p', '{input}', '-o', '{outputDir}'],
    })

    await expect(converter.convert(new Uint8Array([1]), '/tmp/null.pdf')).rejects.toThrow()
  })
})

describe('externalCommandPdfConverter: output selection', () => {
  beforeEach(() => {
    vi.mocked(execa as any).mockReset()
  })

  it('selects the correct markdown file by basename', async () => {
    vi.mocked(execa as any).mockImplementation(async (_command: string, args: string[]) => {
      const outputIndex = args.indexOf('-o')
      const outputDir = args[outputIndex + 1]
      await fs.mkdir(outputDir, { recursive: true })
      await fs.writeFile(path.join(outputDir, 'other.md'), 'wrong file')
      await fs.writeFile(path.join(outputDir, 'demo.md'), 'correct file')
      return {} as any
    })

    const converter = new ExternalCommandPdfConverter('mineru', {
      command: 'mineru',
      args: ['-p', '{input}', '-o', '{outputDir}'],
    })

    const result = await converter.convert(new Uint8Array([1]), '/path/to/demo.pdf')
    expect(result.text).toBe('correct file')
  })

  it('falls back to first markdown file when no basename match', async () => {
    vi.mocked(execa as any).mockImplementation(async (_command: string, args: string[]) => {
      const outputIndex = args.indexOf('-o')
      const outputDir = args[outputIndex + 1]
      await fs.mkdir(outputDir, { recursive: true })
      await fs.writeFile(path.join(outputDir, 'zzz.md'), 'first alphabetically')
      return {} as any
    })

    const converter = new ExternalCommandPdfConverter('mineru', {
      command: 'mineru',
      args: ['-p', '{input}', '-o', '{outputDir}'],
    })

    const result = await converter.convert(new Uint8Array([1]), '/path/to/unknown.pdf')
    expect(result.text).toBe('first alphabetically')
  })

  it('throws when no markdown file is produced', async () => {
    vi.mocked(execa as any).mockImplementation(async () => {
      return {} as any
    })

    const converter = new ExternalCommandPdfConverter('mineru', {
      command: 'mineru',
      args: ['-p', '{input}', '-o', '{outputDir}'],
    })

    await expect(converter.convert(new Uint8Array([1]), '/path/to/empty.pdf')).rejects.toThrow(
      /did not produce a markdown file/,
    )
  })

  it('resolves custom outputFile template', async () => {
    vi.mocked(execa as any).mockImplementation(async (_command: string, args: string[]) => {
      const outputDir = args[args.indexOf('--out') + 1]
      await fs.mkdir(outputDir, { recursive: true })
      await fs.writeFile(path.join(outputDir, 'result.md'), 'custom file content')
      return {} as any
    })

    const converter = new ExternalCommandPdfConverter('mineru', {
      command: 'mineru',
      args: ['-p', '{input}', '--out', '{outputDir}'],
      outputFile: '{outputDir}/result.md',
    })

    const result = await converter.convert(new Uint8Array([1, 2, 3]), '/tmp/report.pdf')
    expect(result.text).toBe('custom file content')
  })

  it('renders {basename} in args', async () => {
    vi.mocked(execa as any).mockImplementation(async (_command: string, args: string[]) => {
      const outIdx = args.indexOf('--out')
      const outDir = args[outIdx + 1]
      const name = args[args.indexOf('--name') + 1]
      await fs.mkdir(outDir, { recursive: true })
      await fs.writeFile(path.join(outDir, `${name}.md`), 'basename rendered')
      return {} as any
    })

    const converter = new ExternalCommandPdfConverter('mineru', {
      command: 'mineru',
      args: ['-p', '{input}', '--out', '{outputDir}', '--name', '{basename}'],
    })

    const result = await converter.convert(new Uint8Array([1]), '/path/to/my-doc.pdf')
    expect(result.text).toBe('basename rendered')
    expect(execa).toHaveBeenCalledWith(
      'mineru',
      expect.arrayContaining(['--name', 'my-doc']),
      expect.any(Object),
    )
  })

  it('throws when output file is not found after conversion', async () => {
    vi.mocked(execa as any).mockImplementation(async () => {
      return {} as any
    })

    const converter = new ExternalCommandPdfConverter('mineru', {
      command: 'mineru',
      args: ['-p', '{input}', '-o', '{outputDir}'],
      outputFile: '{outputDir}/nonexistent.md',
    })

    await expect(converter.convert(new Uint8Array([1]), '/tmp/missing.pdf')).rejects.toThrow(
      /was not found/,
    )
  })

  it('keeps output files on disk when keepOutput is true', async () => {
    let createdOutputDir = ''
    vi.mocked(execa as any).mockImplementation(async (_command: string, args: string[]) => {
      const outputIndex = args.indexOf('-o')
      createdOutputDir = args[outputIndex + 1]
      await fs.mkdir(createdOutputDir, { recursive: true })
      await fs.writeFile(path.join(createdOutputDir, 'demo.md'), '# Kept content')
      return {} as any
    })

    const converter = new ExternalCommandPdfConverter('mineru', {
      command: 'mineru',
      args: ['-p', '{input}', '-o', '{outputDir}'],
      keepOutput: true,
    })

    const result = await converter.convert(new Uint8Array([1]), '/tmp/keep.pdf')

    expect(result.text).toBe('# Kept content')
    expect(result.metadata?.outputDir).toBeDefined()
    // Verify the file still exists on disk after convert returns
    const filePath = path.join(result.metadata!.outputDir!, 'demo.md')
    const exists = await fs.access(filePath).then(() => true).catch(() => false)
    expect(exists).toBe(true)
    // Clean up
    await fs.rm(result.metadata!.outputDir!, { recursive: true, force: true })
  })

  it('includes outputDir in metadata when keepOutput is true', async () => {
    vi.mocked(execa as any).mockImplementation(async (_command: string, args: string[]) => {
      const outputIndex = args.indexOf('-o')
      const outDir = args[outputIndex + 1]
      await fs.mkdir(outDir, { recursive: true })
      await fs.writeFile(path.join(outDir, 'demo.md'), '# metadata')
      return {} as any
    })

    const converter = new ExternalCommandPdfConverter('mineru', {
      command: 'mineru',
      args: ['-p', '{input}', '-o', '{outputDir}'],
      keepOutput: true,
    })

    const result = await converter.convert(new Uint8Array([1]), '/tmp/meta.pdf')
    expect(result.metadata?.outputDir).toBeTruthy()
    expect(result.metadata?.outputPath).toBeTruthy()
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

  it('creates mineru converter with default config when mineru config is omitted', () => {
    const converter = createPdfConverter({
      converter: 'mineru',
    })
    expect(converter.name).toBe('mineru')
  })

  it('creates mineru converter without fallback when opted out', () => {
    const converter = createPdfConverter({
      converter: 'mineru',
      mineru: {
        command: 'mineru',
        args: ['-p', '{input}', '-o', '{outputDir}'],
        fallbackToUnpdf: false,
      },
    })
    expect(converter.name).toBe('mineru')
  })

  it('creates external converter with custom config', () => {
    const converter = createPdfConverter({
      converter: 'external',
      external: {
        command: 'marker_single',
        args: ['{input}', '--output_dir', '{outputDir}'],
        timeout: 120,
      },
    })
    expect(converter.name).toBe('external')
  })
})

describe('converter metadata', () => {
  it('includes converter name in UnpdfConverter result', async () => {
    const buffer = await getPdfBuffer()
    const converter = new UnpdfConverter()
    const result = await converter.convert(buffer)

    expect(result.metadata).toBeDefined()
    expect(result.metadata!.converter).toBe('unpdf')
  })

  it('marks fallback in metadata when primary converter fails', async () => {
    vi.mocked(execa as any).mockReset()
    vi.mocked(execa as any).mockRejectedValue(new Error('mineru crashed'))

    const converter = createPdfConverter({
      converter: 'mineru',
      mineru: {
        command: 'mineru',
        args: ['-p', '{input}', '-o', '{outputDir}'],
        fallbackToUnpdf: true,
      },
    })

    const buffer = await getPdfBuffer()
    const result = await converter.convert(new Uint8Array(buffer), '/tmp/fallback.pdf')

    expect(result.text).toBeTruthy()
    expect(result.metadata?.fallback).toBe('true')
    expect(result.metadata?.converter).toBe('unpdf')
  })

  it('does not mark fallback when primary converter succeeds', async () => {
    vi.mocked(execa as any).mockReset()
    vi.mocked(execa as any).mockImplementation(async (_command: string, args: string[]) => {
      const outputIndex = args.indexOf('-o')
      const outputDir = args[outputIndex + 1]
      await fs.mkdir(outputDir, { recursive: true })
      await fs.writeFile(path.join(outputDir, 'demo.md'), '# mineru success')
      return {} as any
    })

    const converter = createPdfConverter({
      converter: 'mineru',
      mineru: {
        command: 'mineru',
        args: ['-p', '{input}', '-o', '{outputDir}'],
        fallbackToUnpdf: true,
      },
    })

    const buffer = await getPdfBuffer()
    const result = await converter.convert(new Uint8Array(buffer), '/tmp/success.pdf')

    expect(result.metadata?.converter).toBe('mineru')
    expect(result.metadata?.fallback).toBeUndefined()
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
