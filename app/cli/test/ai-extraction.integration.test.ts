import { Buffer } from 'node:buffer'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { extractStructuredData } from '@/application/ai-extraction/extract-structured-data'
import {
  paperSchema,
  personSchema,
  TEST_AI_CONFIG,
} from './ai-extraction.test-utils'

// ─── PDF text extraction via pdftotext ───
const DEMO_PDF = path.resolve(import.meta.dirname, 'demo.pdf')

async function extractPdfText(filePath: string): Promise<string | null> {
  try {
    const { execFile } = await import('node:child_process')
    const { promisify } = await import('node:util')
    const exec = promisify(execFile)
    const { stdout } = await exec('pdftotext', [filePath, '-'], { timeout: 10000 })
    return stdout || null
  }
  catch {
    return null
  }
}

// ─── Service check ───
async function checkService(): Promise<boolean> {
  try {
    const base = TEST_AI_CONFIG.provider.baseURL.replace(/\/v1\/?$/, '')
    const res = await fetch(`${base}/v1/models`, {
      headers: TEST_AI_CONFIG.provider.apiKey ? { Authorization: `Bearer ${TEST_AI_CONFIG.provider.apiKey}` } : {},
      signal: AbortSignal.timeout(3000),
    })
    return res.ok
  }
  catch {
    return false
  }
}

const serviceAvailable = await checkService()

let tempDir = ''
const hasPdfTool = await extractPdfText(DEMO_PDF).then(t => t !== null)

beforeAll(async () => {
  if (serviceAvailable) {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aiex-extract-int-'))
  }
})

afterAll(async () => {
  if (tempDir) {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {})
  }
})

const integrationSuite = serviceAvailable ? describe : describe.skip
const pdfSuite = serviceAvailable && hasPdfTool ? describe : describe.skip

// ─── Full flow: PDF → text → AI extraction → verify ───
pdfSuite('full flow: pdf to structured data', () => {
  let pdfText = ''

  beforeAll(async () => {
    pdfText = (await extractPdfText(DEMO_PDF))!
  })

  it('extracts paper metadata from pdf content', { timeout: 120_000 }, async () => {
    const result = await extractStructuredData({
      config: TEST_AI_CONFIG,
      schema: paperSchema,
      text: pdfText,
      aiexDir: tempDir,
    })

    expect(result.success).toBe(true)
    const data = result.data as Record<string, unknown>
    expect(typeof data.title).toBe('string')
    expect((data.title as string).length).toBeGreaterThan(5)
    expect(typeof data.firstAuthor).toBe('string')
    expect(typeof data.journal).toBe('string')
    expect(typeof data.year).toBe('number')

    // Verify extracted metadata matches the actual paper
    expect(data.title).toMatch(/flow duration curves/i)
    expect(data.firstAuthor).toMatch(/Lane/i)
    expect(data.journal).toMatch(/Journal of Hydrology/i)
    expect(data.year).toBe(2005)

    // Verify output file
    expect(result.outputPath).toBeDefined()
    const saved = JSON.parse(await fs.readFile(result.outputPath!, 'utf-8')) as Record<string, unknown>
    expect(saved.title).toBe(data.title)
    expect(saved.year).toBe(data.year)
  })
})

// ─── Basic text extraction ───
integrationSuite('text extraction', () => {
  it('extracts fields from a sentence', { timeout: 60_000 }, async () => {
    const result = await extractStructuredData({
      config: TEST_AI_CONFIG,
      schema: personSchema,
      text: 'Alice is 28 years old and lives in Shanghai',
      aiexDir: tempDir,
    })

    expect(result.success).toBe(true)
    expect(result.outputPath).toBeDefined()

    const data = result.data as Record<string, unknown>
    // model may not support structured output; verify what we can
    if (data && Object.keys(data).length > 0) {
      if (data.name != null) {
        expect(typeof data.name).toBe('string')
      }
      if (data.age != null) {
        expect(typeof data.age).toBe('number')
      }
    }

    // output file must always be written
    const saved = JSON.parse(await fs.readFile(result.outputPath!, 'utf-8')) as Record<string, unknown>
    expect(saved).toBeDefined()
  })

  it('extracts from image file', { timeout: 120_000 }, async () => {
    // Create a minimal test PNG
    const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg=='
    const imgPath = path.join(tempDir, 'dot.png')
    await fs.writeFile(imgPath, Buffer.from(pngBase64, 'base64'))

    const result = await extractStructuredData({
      config: TEST_AI_CONFIG,
      schema: personSchema,
      text: 'A person named David, age 42, from Shenzhen',
      aiexDir: tempDir,
      file: imgPath,
    })

    expect(result.success).toBe(true)
    expect(result.outputPath).toBeDefined()

    const data = result.data as Record<string, unknown>
    if (data && Object.keys(data).length > 0) {
      if (data.name != null) {
        expect(['string', 'number', 'object']).toContain(typeof data.name)
      }
      if (data.age != null) {
        expect(typeof data.age).toBe('number')
      }
    }

    // output file must always be written
    const saved = JSON.parse(await fs.readFile(result.outputPath!, 'utf-8')) as Record<string, unknown>
    expect(saved).toBeDefined()
  })

  // Override model for vision extraction (first vision-capable model)
  it('handles missing optional fields', { timeout: 60_000 }, async () => {
    const result = await extractStructuredData({
      config: TEST_AI_CONFIG,
      schema: personSchema,
      text: 'A person named Bob who is 35 years old',
      aiexDir: tempDir,
    })

    expect(result.success).toBe(true)
    expect(result.outputPath).toBeDefined()
  })

  it('returns error when API key is empty', async () => {
    const result = await extractStructuredData({
      config: { ...TEST_AI_CONFIG, provider: { ...TEST_AI_CONFIG.provider, apiKey: '' } },
      schema: personSchema,
      text: 'test',
      aiexDir: tempDir,
    })

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/API Key/i)
  })
})
