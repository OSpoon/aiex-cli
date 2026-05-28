import { Buffer } from 'node:buffer'
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { listSupportedFiles } from '@/application/extraction'
import { describeExtractFileInput, isImageFile, readExtractFileInput } from '@/application/input/prepare-extraction-input'
import { listSchemas, loadSchema } from '@/application/schema/load-schema'

const imageOcrMock = vi.hoisted(() => ({
  recognizeImageText: vi.fn(),
  shouldUseImageOcrFallback: vi.fn(() => false),
}))

vi.mock('@/infrastructure/ocr/system-ocr', () => imageOcrMock)

afterEach(() => {
  imageOcrMock.recognizeImageText.mockReset()
  imageOcrMock.shouldUseImageOcrFallback.mockReset()
  imageOcrMock.shouldUseImageOcrFallback.mockReturnValue(false)
})

describe('listSupportedFiles', () => {
  it('should filter files by supported extensions', () => {
    const dir = `/tmp/test-extract-${Date.now()}`
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(`${dir}/test.txt`, 'hello')
    fs.writeFileSync(`${dir}/test.pdf`, '%PDF')
    fs.writeFileSync(`${dir}/test.png`, 'png')
    fs.writeFileSync(`${dir}/test.exe`, 'binary')
    fs.writeFileSync(`${dir}/test.json`, '{}')

    const files = listSupportedFiles(dir)
    expect(files).toHaveLength(4)
    expect(files.some(f => f.endsWith('.txt'))).toBe(true)
    expect(files.some(f => f.endsWith('.pdf'))).toBe(true)
    expect(files.some(f => f.endsWith('.png'))).toBe(true)
    expect(files.some(f => f.endsWith('.json'))).toBe(true)
    expect(files.some(f => f.endsWith('.exe'))).toBe(false)

    fs.rmSync(dir, { recursive: true })
  })

  it('should filter by glob * pattern', () => {
    const dir = `/tmp/test-extract-glob-${Date.now()}`
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(`${dir}/report.pdf`, '%PDF')
    fs.writeFileSync(`${dir}/invoice.pdf`, '%PDF')
    fs.writeFileSync(`${dir}/notes.txt`, 'text')

    const files = listSupportedFiles(dir, '*.pdf')
    expect(files).toHaveLength(2)
    expect(files.every(f => f.endsWith('.pdf'))).toBe(true)

    fs.rmSync(dir, { recursive: true })
  })

  it('should filter by glob prefix pattern', () => {
    const dir = `/tmp/test-extract-prefix-${Date.now()}`
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(`${dir}/report-2024.pdf`, '%PDF')
    fs.writeFileSync(`${dir}/report-2025.pdf`, '%PDF')
    fs.writeFileSync(`${dir}/summary-2024.pdf`, '%PDF')
    fs.writeFileSync(`${dir}/notes.txt`, 'text')

    const files = listSupportedFiles(dir, 'report-*.pdf')
    expect(files).toHaveLength(2)
    expect(files.every(f => path.basename(f).startsWith('report-'))).toBe(true)

    fs.rmSync(dir, { recursive: true })
  })

  it('should filter by glob {a,b} alternation pattern', () => {
    const dir = `/tmp/test-extract-alt-${Date.now()}`
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(`${dir}/data.csv`, 'a,b')
    fs.writeFileSync(`${dir}/data.yaml`, 'a: b')
    fs.writeFileSync(`${dir}/data.json`, '{}')

    const files = listSupportedFiles(dir, '*.{csv,yaml}')
    expect(files).toHaveLength(2)
    expect(files.every(f => f.endsWith('.csv') || f.endsWith('.yaml'))).toBe(true)

    fs.rmSync(dir, { recursive: true })
  })
})

describe('loadSchema', () => {
  it('should load and validate a valid schema file', async () => {
    const dir = `/tmp/test-schema-${Date.now()}`
    fs.mkdirSync(path.join(dir, 'schema'), { recursive: true })
    const schemaPath = path.join(dir, 'schema', 'test.json')
    fs.writeFileSync(schemaPath, JSON.stringify({
      title: 'Test',
      type: 'object',
      properties: { name: { type: 'string' } },
      table: { name: 'test' },
    }))

    const config = { schemaPath: path.join(dir, 'schema'), databasePath: '', drizzleSchemaPath: '', migrationsPath: '', drizzleConfigPath: '' }
    const result = await loadSchema(config, 'test')
    expect(result.schema).toBeDefined()
    expect(result.schema.title).toBe('Test')

    fs.rmSync(dir, { recursive: true })
  })

  it('should return error for missing schema file', async () => {
    const config = { schemaPath: '/nonexistent/schema', databasePath: '', drizzleSchemaPath: '', migrationsPath: '', drizzleConfigPath: '' }
    const result = await loadSchema(config, 'missing')
    expect(result.schema).toBeNull()
    expect(result.error).toBeDefined()
    expect(result.error).toContain('Cannot read schema file')
  })
})

describe('listSchemas', () => {
  it('should list schema files without .json extension', async () => {
    const dir = `/tmp/test-schemas-${Date.now()}`
    fs.mkdirSync(path.join(dir, 'schema'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'schema', 'users.json'), '{}')
    fs.writeFileSync(path.join(dir, 'schema', 'posts.json'), '{}')
    fs.writeFileSync(path.join(dir, 'schema', 'readme.txt'), 'hello')

    const schemas = await listSchemas(dir)
    expect(schemas).toEqual(['posts', 'users'])

    fs.rmSync(dir, { recursive: true })
  })

  it('should return empty array when schema directory does not exist', async () => {
    const schemas = await listSchemas('/nonexistent-path')
    expect(schemas).toEqual([])
  })
})

describe('isImageFile', () => {
  it('should identify image files by extension', () => {
    expect(isImageFile('photo.png')).toBe(true)
    expect(isImageFile('photo.jpg')).toBe(true)
    expect(isImageFile('photo.jpeg')).toBe(true)
    expect(isImageFile('photo.webp')).toBe(true)
    expect(isImageFile('photo.gif')).toBe(false)
    expect(isImageFile('photo.bmp')).toBe(false)
    expect(isImageFile('photo.svg')).toBe(false)
    expect(isImageFile('document.pdf')).toBe(false)
    expect(isImageFile('notes.txt')).toBe(false)
    expect(isImageFile('data.json')).toBe(false)
  })
})

describe('readExtractFileInput', () => {
  it('describes image files as vision input when OCR fallback is not selected', async () => {
    const dir = `/tmp/test-describe-image-file-${Date.now()}`
    fs.mkdirSync(dir, { recursive: true })
    const filePath = path.join(dir, 'receipt.dat')
    fs.writeFileSync(filePath, Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'))

    const input = await describeExtractFileInput(filePath)

    expect(input).toEqual({
      kind: 'image',
      mime: 'image/png',
      handler: 'image_vision',
    })

    fs.rmSync(dir, { recursive: true })
  })

  it('keeps image files as file input when OCR fallback is not selected', async () => {
    const dir = `/tmp/test-read-image-file-${Date.now()}`
    fs.mkdirSync(dir, { recursive: true })
    const filePath = path.join(dir, 'receipt.dat')
    fs.writeFileSync(filePath, Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'))

    const input = await readExtractFileInput(filePath)

    expect(input).toEqual({
      text: '',
      filePath,
      inputProcessing: {
        kind: 'image',
        mime: 'image/png',
        handler: 'image_vision',
      },
      quality: {
        input: {
          kind: 'image',
        },
      },
    })
    expect(imageOcrMock.recognizeImageText).not.toHaveBeenCalled()

    fs.rmSync(dir, { recursive: true })
  })

  it('returns OCR text instead of file input when image OCR fallback is selected', async () => {
    const dir = `/tmp/test-read-image-ocr-${Date.now()}`
    fs.mkdirSync(dir, { recursive: true })
    const filePath = path.join(dir, 'receipt.dat')
    fs.writeFileSync(filePath, Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'))

    const aiConfig = {
      provider: {
        baseURL: 'http://localhost:11434/v1',
        apiKey: 'test-key',
        models: [{ name: 'text-model', capabilities: { vision: false, structuredOutput: true } }],
      },
      prompt: {
        systemTemplate: '{schema}',
        userTemplate: '{text}',
      },
      extraction: {
        outputDir: '.aiex/extracted',
      },
      image: {
        ocrFallback: 'localAuto' as const,
        ocrLanguages: 'en-US',
      },
    }

    imageOcrMock.shouldUseImageOcrFallback.mockReturnValue(true)
    imageOcrMock.recognizeImageText.mockResolvedValue({
      text: 'total 12.50',
      confidence: 0.91,
    })

    const input = await readExtractFileInput(filePath, aiConfig)

    expect(input).toEqual({
      text: 'total 12.50',
      inputProcessing: {
        kind: 'image',
        mime: 'image/png',
        handler: 'image_local_ocr',
      },
      quality: {
        input: {
          kind: 'image',
          textLength: 11,
          emptyText: false,
          ocr: {
            confidence: 0.91,
            textLength: 11,
            platform: expect.any(String),
          },
        },
      },
    })
    expect(imageOcrMock.shouldUseImageOcrFallback).toHaveBeenCalledWith(aiConfig, undefined)
    expect(imageOcrMock.recognizeImageText).toHaveBeenCalledWith(filePath)

    fs.rmSync(dir, { recursive: true })
  })

  it('converts PDF files by content even when the extension is wrong', async () => {
    const dir = `/tmp/test-read-pdf-kind-${Date.now()}`
    fs.mkdirSync(dir, { recursive: true })
    const filePath = path.join(dir, 'document.bin')
    fs.copyFileSync(path.resolve(import.meta.dirname, 'demo.pdf'), filePath)

    const input = await readExtractFileInput(filePath)

    expect(input.text).toContain('flow duration curves')
    expect(input.inputProcessing).toEqual({
      kind: 'pdf',
      mime: 'application/pdf',
      handler: 'pdf_converter',
      converter: 'unpdf',
    })

    fs.rmSync(dir, { recursive: true })
  })

  it('rejects SVG content during input description', async () => {
    const dir = `/tmp/test-describe-svg-file-${Date.now()}`
    fs.mkdirSync(dir, { recursive: true })
    const filePath = path.join(dir, 'icon.dat')
    fs.writeFileSync(filePath, '<svg xmlns="http://www.w3.org/2000/svg"></svg>')

    await expect(describeExtractFileInput(filePath)).rejects.toThrow('Unsupported file type "image/svg+xml"')

    fs.rmSync(dir, { recursive: true })
  })
})
