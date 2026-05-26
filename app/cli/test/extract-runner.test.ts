import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { isImageFile, listSchemas, listSupportedFiles, loadSchema, readExtractFileInput } from '@/core/extract-runner'

const imageOcrMock = vi.hoisted(() => ({
  recognizeImageText: vi.fn(),
}))

vi.mock('@/core/image-ocr', () => imageOcrMock)

const transcribeMock = vi.hoisted(() => ({
  transcribeImageWithVision: vi.fn(),
}))

vi.mock('@/core/ai-extraction/transcriber', () => transcribeMock)

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
  transcribeMock.transcribeImageWithVision.mockReset()
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
  it('runs image files through OCR and reports OCR availability errors', async () => {
    const dir = `/tmp/test-read-image-file-${Date.now()}`
    fs.mkdirSync(dir, { recursive: true })
    const filePath = path.join(dir, 'receipt.png')
    fs.writeFileSync(filePath, 'png')

    imageOcrMock.recognizeImageText.mockRejectedValue(new Error('Local OCR is unavailable'))

    await expect(readExtractFileInput(filePath)).rejects.toThrow('Local OCR is unavailable')
    expect(imageOcrMock.recognizeImageText).toHaveBeenCalledWith(filePath, undefined)

    fs.rmSync(dir, { recursive: true })
  })

  it('returns OCR text instead of file input for image files', async () => {
    const dir = `/tmp/test-read-image-ocr-${Date.now()}`
    fs.mkdirSync(dir, { recursive: true })
    const filePath = path.join(dir, 'receipt.png')
    fs.writeFileSync(filePath, 'png')

    const aiConfig = {
      provider: {
        baseURL: 'http://localhost:11434/v1',
        apiKey: 'test-key',
        models: [{ name: 'text-model', capabilities: { structuredOutput: true } }],
      },
      prompt: {
        systemTemplate: '{schema}',
        userTemplate: '{text}',
      },
      extraction: {
        outputDir: '.aiex/extracted',
      },
      image: {
        imageConversion: 'local' as const,
        ocrLanguages: 'en-US',
      },
    }

    imageOcrMock.recognizeImageText.mockResolvedValue({
      text: 'total 12.50',
      confidence: 0.91,
    })

    const input = await readExtractFileInput(filePath, aiConfig)

    expect(input).toEqual({ text: 'total 12.50' })
    expect(imageOcrMock.recognizeImageText).toHaveBeenCalledWith(filePath, aiConfig.image)

    fs.rmSync(dir, { recursive: true })
  })

  it('uses vision model transcription when configured', async () => {
    const dir = `/tmp/test-read-image-vision-${Date.now()}`
    fs.mkdirSync(dir, { recursive: true })
    const filePath = path.join(dir, 'receipt.png')
    fs.writeFileSync(filePath, 'png')

    const aiConfig = {
      provider: {
        baseURL: 'http://localhost:11434/v1',
        apiKey: 'test-key',
        models: [],
        timeout: 60,
      },
      prompt: { systemTemplate: '{schema}', userTemplate: '{text}' },
      extraction: { outputDir: '.aiex/extracted' },
      image: {
        imageConversion: 'vision' as const,
        imageModelName: 'gpt-4o',
      },
    }

    transcribeMock.transcribeImageWithVision.mockResolvedValue({
      text: 'invoice total 100',
      modelName: 'gpt-4o',
    })

    const input = await readExtractFileInput(filePath, aiConfig)

    expect(input).toEqual({ text: 'invoice total 100' })
    expect(transcribeMock.transcribeImageWithVision).toHaveBeenCalledWith(
      filePath,
      'http://localhost:11434/v1',
      'test-key',
      'gpt-4o',
      60000,
    )
    expect(imageOcrMock.recognizeImageText).not.toHaveBeenCalled()

    fs.rmSync(dir, { recursive: true })
  })

  it('uses vision-specific baseURL and apiKey when provided', async () => {
    const dir = `/tmp/test-read-image-vision-custom-${Date.now()}`
    fs.mkdirSync(dir, { recursive: true })
    const filePath = path.join(dir, 'receipt.png')
    fs.writeFileSync(filePath, 'png')

    const aiConfig = {
      provider: {
        baseURL: 'http://default/v1',
        apiKey: 'default-key',
        models: [],
      },
      prompt: { systemTemplate: '{schema}', userTemplate: '{text}' },
      extraction: { outputDir: '.aiex/extracted' },
      image: {
        imageConversion: 'vision' as const,
        imageModelName: 'gpt-4o',
        visionBaseURL: 'http://vision/v1',
        visionApiKey: 'vision-key',
      },
    }

    transcribeMock.transcribeImageWithVision.mockResolvedValue({
      text: 'result',
      modelName: 'gpt-4o',
    })

    await readExtractFileInput(filePath, aiConfig)

    expect(transcribeMock.transcribeImageWithVision).toHaveBeenCalledWith(
      filePath,
      'http://vision/v1',
      'vision-key',
      'gpt-4o',
      expect.any(Number),
    )

    fs.rmSync(dir, { recursive: true })
  })

  it('falls back to local OCR when vision transcription fails', async () => {
    const dir = `/tmp/test-read-image-vision-fallback-${Date.now()}`
    fs.mkdirSync(dir, { recursive: true })
    const filePath = path.join(dir, 'receipt.png')
    fs.writeFileSync(filePath, 'png')

    const aiConfig = {
      provider: {
        baseURL: 'http://localhost:11434/v1',
        apiKey: 'test-key',
        models: [],
      },
      prompt: { systemTemplate: '{schema}', userTemplate: '{text}' },
      extraction: { outputDir: '.aiex/extracted' },
      image: {
        imageConversion: 'vision' as const,
        imageModelName: 'gpt-4o',
      },
    }

    transcribeMock.transcribeImageWithVision.mockRejectedValue(new Error('API error'))
    imageOcrMock.recognizeImageText.mockResolvedValue({
      text: 'ocr fallback text',
      confidence: 0.85,
    })

    const input = await readExtractFileInput(filePath, aiConfig)

    expect(input).toEqual({ text: 'ocr fallback text' })
    expect(transcribeMock.transcribeImageWithVision).toHaveBeenCalled()
    expect(imageOcrMock.recognizeImageText).toHaveBeenCalledWith(filePath, aiConfig.image)

    fs.rmSync(dir, { recursive: true })
  })

  it('uses local OCR when vision mode is set but model name is empty', async () => {
    const dir = `/tmp/test-read-image-vision-noname-${Date.now()}`
    fs.mkdirSync(dir, { recursive: true })
    const filePath = path.join(dir, 'receipt.png')
    fs.writeFileSync(filePath, 'png')

    const aiConfig = {
      provider: {
        baseURL: 'http://localhost:11434/v1',
        apiKey: 'test-key',
        models: [],
      },
      prompt: { systemTemplate: '{schema}', userTemplate: '{text}' },
      extraction: { outputDir: '.aiex/extracted' },
      image: {
        imageConversion: 'vision' as const,
      },
    }

    imageOcrMock.recognizeImageText.mockResolvedValue({
      text: 'ocr result',
      confidence: 0.9,
    })

    const input = await readExtractFileInput(filePath, aiConfig)

    expect(input).toEqual({ text: 'ocr result' })
    expect(transcribeMock.transcribeImageWithVision).not.toHaveBeenCalled()
    expect(imageOcrMock.recognizeImageText).toHaveBeenCalled()

    fs.rmSync(dir, { recursive: true })
  })
})

describe('extractSingle with Pipeline mode enhancements', () => {
  it('runs Pipeline mode through one unified chunk extraction path', async () => {
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
        models: [{ name: 'mock-model', capabilities: { structuredOutput: true } }],
      },
      extraction: {
        outputDir: '.aiex/extracted',
        concurrency: 2,
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
      return { success: true, data: { name: null, revenue: null } }
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
    expect(extractStructuredDataMock).toHaveBeenCalled()
    expect(extractStructuredDataMock.mock.calls.length).toBeGreaterThan(1)
    expect(extractStructuredDataMock.mock.calls.every(([input]) => typeof input.text === 'string')).toBe(true)

    fs.rmSync(dir, { recursive: true })
  })
})
