import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { ExternalCommandPdfConverter } from '@/core/pdf-converter'

const DEMO_PDF = path.resolve(import.meta.dirname, 'demo.pdf')

// All tests in this file require AIEX_TEST_MINERU=1 to run.
const enabled = process.env.AIEX_TEST_MINERU === '1'

const suite = enabled ? describe : describe.skip

suite('mineru integration', { timeout: 600_000 }, () => {
  const converter = new ExternalCommandPdfConverter('mineru', {
    command: 'mineru',
    args: ['-p', '{input}', '-o', '{outputDir}'],
    timeout: 600,
  })

  it('mineru is available', async () => {
    const { execFile } = await import('node:child_process')
    const { promisify } = await import('node:util')
    const exec = promisify(execFile)
    const { stdout } = await exec('mineru', ['--version'])
    expect(stdout).toMatch(/mineru,\s*version/i)
  })

  it('rejects non-existent input path', async () => {
    await expect(
      converter.convert(new Uint8Array([1, 2, 3]), '/tmp/nonexistent-document.pdf'),
    ).rejects.toThrow()
  })

  it('converts demo.pdf to markdown', async () => {
    const pdfBuffer = await fs.readFile(DEMO_PDF)
    const result = await converter.convert(new Uint8Array(pdfBuffer), DEMO_PDF)

    expect(result.text).toBeTruthy()
    expect(typeof result.text).toBe('string')
    expect(result.text.length).toBeGreaterThan(50)
    expect(result.metadata?.converter).toBe('mineru')
    expect(result.metadata?.outputPath).toBeDefined()
    expect(result.metadata!.outputPath!.endsWith('.md')).toBe(true)
  })

  it('converts PDF buffer without filePath', async () => {
    const pdfBuffer = await fs.readFile(DEMO_PDF)
    const result = await converter.convert(new Uint8Array(pdfBuffer))

    expect(result.text).toBeTruthy()
    expect(typeof result.text).toBe('string')
    expect(result.text.length).toBeGreaterThan(50)
    expect(result.metadata?.converter).toBe('mineru')
  })

  it('produces markdown with meaningful content', async () => {
    const pdfBuffer = await fs.readFile(DEMO_PDF)
    const result = await converter.convert(new Uint8Array(pdfBuffer), DEMO_PDF)

    expect(result.text).toMatch(/flow duration curves/i)
    expect(result.text).toMatch(/Journal of Hydrology/i)
    expect(result.text).toMatch(/Lane/i)
  })
})
