import fs from 'node:fs'
import path from 'node:path'
import { outro } from '@clack/prompts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { extractCommand } from '@/commands/extract'
import { extractStructuredData, insertExtractedData, readAIConfig } from '@/core/ai-extraction'

// —— vitest mocks ——
vi.mock('@/core/ai-extraction', () => ({
  extractStructuredData: vi.fn(),
  insertExtractedData: vi.fn(),
  readAIConfig: vi.fn(),
}))

vi.mock('@clack/prompts', () => ({
  intro: vi.fn(),
  outro: vi.fn(),
  isCancel: vi.fn(() => false),
  select: vi.fn(),
  spinner: vi.fn(() => ({ start: vi.fn(), stop: vi.fn() })),
  text: vi.fn(),
}))

vi.mock('@/core/pdf-converter', () => ({
  createPdfConverter: vi.fn(() => ({
    convert: vi.fn(async () => ({ text: 'pdf text content', pageCount: 2 })),
  })),
}))

vi.mock('better-sqlite3', () => {
  class MockDb {
    prepare = vi.fn(() => ({
      get: vi.fn(() => ({ name: 'test_table' })),
      run: vi.fn(() => ({ lastInsertRowid: 1 })),
    }))

    close = vi.fn()
    transaction = vi.fn((fn: () => void) => fn())
    exec = vi.fn()
  }
  return { default: MockDb }
})
const cmd = extractCommand as any
const originalCwd = process.cwd()

function createProjectFixture(): string {
  const dir = `/tmp/test-extract-project-${Date.now()}-${Math.random().toString(36).slice(2)}`
  fs.mkdirSync(path.join(dir, '.aiex', 'schema'), { recursive: true })
  fs.writeFileSync(path.join(dir, '.aiex', 'database.db'), '')
  fs.writeFileSync(path.join(dir, '.aiex', 'schema', 'test.json'), JSON.stringify({
    title: 'Test',
    type: 'object',
    properties: { name: { type: 'string' } },
    table: { name: 'test_table' },
  }))
  return dir
}

function mockAIConfig(): void {
  vi.mocked(readAIConfig).mockResolvedValueOnce({
    provider: { baseURL: 'https://test.com', apiKey: 'test-key', models: [{ name: 'test-model', capabilities: { vision: false, structuredOutput: true } }] },
    prompt: { systemTemplate: 'sys', userTemplate: 'usr' },
    extraction: { outputDir: '/tmp' },
  })
}

describe('extractCommand definition', () => {
  it('should have correct meta name and description', () => {
    expect(cmd.meta.name).toBe('extract')
    expect(cmd.meta.description).toBe('Extract structured data from text, images, or PDFs')
  })

  it('should define schema arg as optional', () => {
    expect(cmd.args.schema).toBeDefined()
    expect(cmd.args.schema.required ?? false).toBe(false)
  })

  it('should define new args: dir and glob', () => {
    expect(cmd.args.dir).toBeDefined()
    expect(cmd.args.glob).toBeDefined()
  })

  it('should have correct arg aliases', () => {
    expect(cmd.args.dir.alias).toBe('d')
    expect(cmd.args.glob.alias).toBe('g')
  })
})

describe('extractCommand.run', () => {
  beforeEach(() => {
    process.exitCode = 0
  })

  afterEach(() => {
    process.exitCode = 0
    process.chdir(originalCwd)
    vi.clearAllMocks()
  })

  it('should fail when combining --dir and --file', async () => {
    await cmd.run({ args: { dir: '/tmp', file: '/tmp/test.txt' } })
    expect(process.exitCode).toBe(1)
  })

  it('should fail when combining --dir and --text', async () => {
    await cmd.run({ args: { dir: '/tmp', text: 'hello' } })
    expect(process.exitCode).toBe(1)
  })

  it('should fail without crash for empty batch directory', async () => {
    const dir = `/tmp/test-extract-empty-${Date.now()}`
    fs.mkdirSync(dir, { recursive: true })

    mockAIConfig()

    await cmd.run({ args: { dir, schema: 'test' } })
    expect(process.exitCode).toBe(1)

    fs.rmSync(dir, { recursive: true })
  })

  it('should fail gracefully for nonexistent batch directory', async () => {
    const dir = `/tmp/test-extract-nonexistent-${Date.now()}`

    mockAIConfig()

    await cmd.run({ args: { dir, schema: 'test' } })
    expect(process.exitCode).toBe(1)
  })

  it('should fail for nonexistent file in -f mode', async () => {
    mockAIConfig()

    await cmd.run({ args: { schema: 'test', file: '/nonexistent/test-file.txt' } })
    expect(process.exitCode).toBe(1)
  })

  it('should process all files in batch mode successfully', async () => {
    const projectDir = createProjectFixture()
    const inputDir = path.join(projectDir, 'inputs')
    fs.mkdirSync(inputDir)
    fs.writeFileSync(path.join(inputDir, 'one.txt'), 'one')
    fs.writeFileSync(path.join(inputDir, 'two.txt'), 'two')
    process.chdir(projectDir)

    mockAIConfig()
    vi.mocked(extractStructuredData).mockResolvedValue({
      success: true,
      data: { name: 'ok' },
    })
    vi.mocked(insertExtractedData).mockReturnValue({
      success: true,
      tablesInserted: [{ table: 'test_table', rowId: 1 }],
    })

    await cmd.run({ args: { dir: inputDir, schema: 'test' } })

    expect(process.exitCode).toBe(0)
    expect(extractStructuredData).toHaveBeenCalledTimes(2)
    expect(outro).toHaveBeenLastCalledWith('Done!')

    fs.rmSync(projectDir, { recursive: true, force: true })
  })

  it('should set exit code and avoid Done when batch has partial failures', async () => {
    const projectDir = createProjectFixture()
    const inputDir = path.join(projectDir, 'inputs')
    fs.mkdirSync(inputDir)
    fs.writeFileSync(path.join(inputDir, 'one.txt'), 'one')
    fs.writeFileSync(path.join(inputDir, 'two.txt'), 'two')
    process.chdir(projectDir)

    mockAIConfig()
    vi.mocked(extractStructuredData)
      .mockResolvedValueOnce({ success: true, data: { name: 'ok' } })
      .mockResolvedValueOnce({ success: false, error: 'AI failed' })
    vi.mocked(insertExtractedData).mockReturnValue({
      success: true,
      tablesInserted: [{ table: 'test_table', rowId: 1 }],
    })

    await cmd.run({ args: { dir: inputDir, schema: 'test' } })

    expect(process.exitCode).toBe(1)
    expect(extractStructuredData).toHaveBeenCalledTimes(2)
    expect(outro).toHaveBeenLastCalledWith('Completed with failures (1 failed)')
    expect(outro).not.toHaveBeenCalledWith('Done!')

    fs.rmSync(projectDir, { recursive: true, force: true })
  })
})
