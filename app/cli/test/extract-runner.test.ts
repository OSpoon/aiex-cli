import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { isImageFile, listSchemas, listSupportedFiles, loadSchema, readExtractFileInput } from '@/core/extract-runner'

const imageOcrMock = vi.hoisted(() => ({
  recognizeImageText: vi.fn(),
  shouldUseImageOcrFallback: vi.fn(() => false),
}))

vi.mock('@/core/image-ocr', () => imageOcrMock)

const extractStructuredDataMock = vi.hoisted(() => vi.fn())

vi.mock('@/core/ai-extraction', async (importOriginal) => {
  const original = await importOriginal<any>()
  return {
    ...original,
    extractStructuredData: extractStructuredDataMock,
  }
})

afterEach(() => {
  imageOcrMock.recognizeImageText.mockReset()
  imageOcrMock.shouldUseImageOcrFallback.mockReset()
  imageOcrMock.shouldUseImageOcrFallback.mockReturnValue(false)
  extractStructuredDataMock.mockReset()
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
    expect(isImageFile('photo.gif')).toBe(true)
    expect(isImageFile('photo.webp')).toBe(true)
    expect(isImageFile('photo.bmp')).toBe(true)
    expect(isImageFile('photo.svg')).toBe(true)
    expect(isImageFile('document.pdf')).toBe(false)
    expect(isImageFile('notes.txt')).toBe(false)
    expect(isImageFile('data.json')).toBe(false)
  })
})

describe('readExtractFileInput', () => {
  it('keeps image files as file input when OCR fallback is not selected', async () => {
    const dir = `/tmp/test-read-image-file-${Date.now()}`
    fs.mkdirSync(dir, { recursive: true })
    const filePath = path.join(dir, 'receipt.png')
    fs.writeFileSync(filePath, 'png')

    const input = await readExtractFileInput(filePath)

    expect(input).toEqual({ text: '', filePath })
    expect(imageOcrMock.recognizeImageText).not.toHaveBeenCalled()

    fs.rmSync(dir, { recursive: true })
  })

  it('returns OCR text instead of file input when image OCR fallback is selected', async () => {
    const dir = `/tmp/test-read-image-ocr-${Date.now()}`
    fs.mkdirSync(dir, { recursive: true })
    const filePath = path.join(dir, 'receipt.png')
    fs.writeFileSync(filePath, 'png')

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
        ocrFallback: 'local' as const,
        ocrLanguages: 'en-US',
      },
    }

    imageOcrMock.shouldUseImageOcrFallback.mockReturnValue(true)
    imageOcrMock.recognizeImageText.mockResolvedValue({
      text: 'total 12.50',
      confidence: 0.91,
    })

    const input = await readExtractFileInput(filePath, aiConfig)

    expect(input).toEqual({ text: 'total 12.50' })
    expect(imageOcrMock.shouldUseImageOcrFallback).toHaveBeenCalledWith(aiConfig, undefined)
    expect(imageOcrMock.recognizeImageText).toHaveBeenCalledWith(filePath, aiConfig.image)

    fs.rmSync(dir, { recursive: true })
  })
})

describe('extractSingle with Pipeline mode enhancements', () => {
  it('runs Pipeline mode with concurrency and pre-filtering', async () => {
    const dir = `/tmp/test-extract-runner-pipeline-${Date.now()}`
    fs.mkdirSync(path.join(dir, 'schema'), { recursive: true })
    const schemaPath = path.join(dir, 'schema', 'company.json')
    fs.writeFileSync(schemaPath, JSON.stringify({
      title: 'Company',
      type: 'object',
      properties: {
        name: { type: 'string' },
        revenue: { type: 'number' },
      },
      table: { name: 'company' },
    }))

    const config = { schemaPath: path.join(dir, 'schema'), databasePath: '', drizzleSchemaPath: '', migrationsPath: '', drizzleConfigPath: '' }
    const aiConfig = {
      provider: {
        baseURL: 'http://mock-url',
        apiKey: 'mock-key',
        models: [{ name: 'mock-model', capabilities: { vision: false, structuredOutput: true } }],
      },
      extraction: {
        outputDir: '.aiex/extracted',
        concurrency: 2,
        preFiltering: true,
        preFilteringLimit: 1,
        overlapSize: 100,
      },
    }

    extractStructuredDataMock.mockImplementation(async (input: any) => {
      if (input.text.includes('metadata')) {
        return { success: true, data: { name: 'ACME Corp' } }
      }
      if (input.text.includes('revenue')) {
        return { success: true, data: { revenue: 1000000 } }
      }
      return { success: false, error: 'Should not extract irrelevant chunk' }
    })

    const { extractSingle } = await import('@/core/extract-runner')

    const textChunk0 = '# Cover Page\nThis is document metadata and general info.\n\n'
    const textChunk1 = '## Section 1\nHere is the financial data with revenue details and profit numbers.\n\n'
    const textChunk2 = '## Section 2\nThis section is completely irrelevant containing stories and jokes.\n\n'

    const longText = `${textChunk0 + 'A sentence with some content for testing. '.repeat(2000)}\n\n${textChunk1}${'B sentence with different content for testing. '.repeat(2000)}\n\n${textChunk2}${'C sentence with yet more content for testing. '.repeat(2000)}`

    const result = await extractSingle(
      dir,
      config,
      aiConfig as any,
      'company',
      longText,
      undefined,
      undefined,
      { quiet: true, insert: false },
    )

    expect(result.success).toBe(true)
    expect(result.data).toEqual({ name: 'ACME Corp', revenue: 1000000 })
    expect(extractStructuredDataMock).toHaveBeenCalledTimes(2)

    fs.rmSync(dir, { recursive: true })
  })
})
