import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { extractCommand } from '@/commands/extract'
import { extractStructuredData, insertExtractedData, readAIConfig } from '@/core/ai-extraction'
import { getFileHash } from '@/utils/hash'

// —— vitest mocks ——
vi.mock('@/core/ai-extraction', () => ({
  calculateChunkTokenBudget: vi.fn(({ configuredMaxTokens }) => configuredMaxTokens ?? 8000),
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
    name: 'mock-converter',
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
const cleanupDirs = new Set<string>()

function cleanupDir(dir: string): void {
  if (path.resolve(process.cwd()).toLowerCase() === path.resolve(dir).toLowerCase())
    process.chdir(originalCwd)
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  cleanupDirs.delete(dir)
}

function createProjectFixture(): string {
  const dir = path.join(os.tmpdir(), `test-extract-hash-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  cleanupDirs.add(dir)
  fs.mkdirSync(path.join(dir, '.aiex', 'schema'), { recursive: true })
  fs.writeFileSync(path.join(dir, '.aiex', 'database.db'), '')
  fs.writeFileSync(path.join(dir, '.aiex', 'schema', 'test_schema.json'), JSON.stringify({
    title: 'TestSchema',
    type: 'object',
    properties: { name: { type: 'string' } },
    table: { name: 'test_table' },
  }))
  return dir
}

function mockAIConfig(): void {
  vi.mocked(readAIConfig).mockResolvedValue({
    provider: { baseURL: 'https://test.com', apiKey: 'test-key', models: [{ name: 'test-model', capabilities: { vision: false, structuredOutput: true } }] },
    prompt: { systemTemplate: 'sys', userTemplate: 'usr' },
    extraction: { outputDir: '.aiex/extracted' },
  })
}

describe('hash-based incremental extraction', () => {
  beforeEach(() => {
    process.exitCode = 0
  })

  afterEach(() => {
    process.exitCode = 0
    process.chdir(originalCwd)
    for (const dir of [...cleanupDirs]) {
      cleanupDir(dir)
    }
    vi.clearAllMocks()
  })

  it('getFileHash should compute hash successfully', async () => {
    const projectDir = createProjectFixture()
    const filePath = path.join(projectDir, 'sample.pdf')
    fs.writeFileSync(filePath, 'dummy pdf contents')
    const hash = await getFileHash(filePath)
    expect(hash).toBeDefined()
    expect(hash).toHaveLength(64) // SHA-256 length is 64 hex chars
    expect(hash).toBe('91d1379d3564a010dfbdf6fb8cf1be4f03dbc3587db87974a3d4c8eccc927301')
  })

  it('should extract non-plain-text file on first run, skip on second run, and force extract on third run', async () => {
    const projectDir = createProjectFixture()
    process.chdir(projectDir)

    const filePath = path.join(projectDir, 'sample.pdf')
    fs.writeFileSync(filePath, 'dummy pdf contents')

    mockAIConfig()
    vi.mocked(extractStructuredData).mockResolvedValue({
      success: true,
      data: { name: 'extracted-from-pdf' },
      outputPath: path.join(projectDir, '.aiex', 'extracted', 'test_table-result.json'),
    })
    vi.mocked(insertExtractedData).mockReturnValue({
      success: true,
      tablesInserted: [{ table: 'test_table', rowId: 1 }],
    })

    // 1st run: should extract
    await cmd.run({ args: { schema: 'test_schema', file: filePath } })
    expect(process.exitCode).toBe(0)
    expect(extractStructuredData).toHaveBeenCalledTimes(1)

    // Check that audit record was created and has fileHash
    const auditDir = path.join(projectDir, '.aiex', 'extracted', '_audit')
    const auditFiles = fs.readdirSync(auditDir)
    expect(auditFiles).toHaveLength(1)
    const audit = JSON.parse(fs.readFileSync(path.join(auditDir, auditFiles[0]), 'utf-8'))
    expect(audit.status).toBe('succeeded')
    expect(audit.source.fileHash).toBe('91d1379d3564a010dfbdf6fb8cf1be4f03dbc3587db87974a3d4c8eccc927301')

    // Reset mocks for 2nd run
    vi.clearAllMocks()
    mockAIConfig()

    // 2nd run: should skip extraction
    await cmd.run({ args: { schema: 'test_schema', file: filePath } })
    expect(process.exitCode).toBe(0)
    expect(extractStructuredData).not.toHaveBeenCalled() // skipped

    // Reset mocks for 3rd run
    vi.clearAllMocks()
    mockAIConfig()
    vi.mocked(extractStructuredData).mockResolvedValue({
      success: true,
      data: { name: 'extracted-from-pdf' },
      outputPath: path.join(projectDir, '.aiex', 'extracted', 'test_table-result.json'),
    })

    // 3rd run with --force: should NOT skip
    await cmd.run({ args: { schema: 'test_schema', file: filePath, force: true } })
    expect(process.exitCode).toBe(0)
    expect(extractStructuredData).toHaveBeenCalledTimes(1)
  })

  it('should never skip plain text files (e.g. .txt) even on subsequent runs', async () => {
    const projectDir = createProjectFixture()
    process.chdir(projectDir)

    const filePath = path.join(projectDir, 'sample.txt')
    fs.writeFileSync(filePath, 'dummy plain text contents')

    mockAIConfig()
    vi.mocked(extractStructuredData).mockResolvedValue({
      success: true,
      data: { name: 'extracted-from-txt' },
      outputPath: path.join(projectDir, '.aiex', 'extracted', 'test_table-result.json'),
    })
    vi.mocked(insertExtractedData).mockReturnValue({
      success: true,
      tablesInserted: [{ table: 'test_table', rowId: 1 }],
    })

    // 1st run: should extract
    await cmd.run({ args: { schema: 'test_schema', file: filePath } })
    expect(process.exitCode).toBe(0)
    expect(extractStructuredData).toHaveBeenCalledTimes(1)

    // Check that audit record has fileHash
    const auditDir = path.join(projectDir, '.aiex', 'extracted', '_audit')
    const auditFiles = fs.readdirSync(auditDir)
    expect(auditFiles).toHaveLength(1)
    const audit = JSON.parse(fs.readFileSync(path.join(auditDir, auditFiles[0]), 'utf-8'))
    expect(audit.status).toBe('succeeded')
    expect(audit.source.fileHash).toBeDefined()

    // Reset mocks for 2nd run
    vi.clearAllMocks()
    mockAIConfig()
    vi.mocked(extractStructuredData).mockResolvedValue({
      success: true,
      data: { name: 'extracted-from-txt' },
      outputPath: path.join(projectDir, '.aiex', 'extracted', 'test_table-result.json'),
    })

    // 2nd run: should NOT skip since it is a plain text file (.txt)
    await cmd.run({ args: { schema: 'test_schema', file: filePath } })
    expect(process.exitCode).toBe(0)
    expect(extractStructuredData).toHaveBeenCalledTimes(1)
  })

  it('should skip already processed non-plain-text files but not plain text files in batch mode', async () => {
    const projectDir = createProjectFixture()
    process.chdir(projectDir)

    const batchDir = path.join(projectDir, 'batch-input')
    fs.mkdirSync(batchDir)
    const pdfPath = path.join(batchDir, 'sample.pdf')
    fs.writeFileSync(pdfPath, 'dummy pdf contents')
    const txtPath = path.join(batchDir, 'sample.txt')
    fs.writeFileSync(txtPath, 'dummy plain text contents')

    mockAIConfig()
    vi.mocked(extractStructuredData).mockResolvedValue({
      success: true,
      data: { name: 'extracted' },
      outputPath: path.join(projectDir, '.aiex', 'extracted', 'test_table-result.json'),
    })
    vi.mocked(insertExtractedData).mockReturnValue({
      success: true,
      tablesInserted: [{ table: 'test_table', rowId: 1 }],
    })

    // 1st batch run: processes both files
    await cmd.run({ args: { schema: 'test_schema', dir: batchDir } })
    expect(process.exitCode).toBe(0)
    expect(extractStructuredData).toHaveBeenCalledTimes(2)

    // Delete the generated .md file to prevent it from being processed as a new input in the next batch runs
    const generatedMdPath = path.join(batchDir, 'sample.md')
    if (fs.existsSync(generatedMdPath)) {
      fs.unlinkSync(generatedMdPath)
    }

    // Reset mocks
    vi.mocked(extractStructuredData).mockClear()
    vi.mocked(insertExtractedData).mockClear()
    mockAIConfig()
    vi.mocked(extractStructuredData).mockResolvedValue({
      success: true,
      data: { name: 'extracted' },
      outputPath: path.join(projectDir, '.aiex', 'extracted', 'test_table-result.json'),
    })
    vi.mocked(insertExtractedData).mockReturnValue({
      success: true,
      tablesInserted: [{ table: 'test_table', rowId: 1 }],
    })

    // 2nd batch run without force: should skip sample.pdf but process sample.txt again
    await cmd.run({ args: { schema: 'test_schema', dir: batchDir } })
    expect(process.exitCode).toBe(0)
    expect(extractStructuredData).toHaveBeenCalledTimes(1) // only 1 call for sample.txt

    // Reset mocks
    vi.clearAllMocks()
    mockAIConfig()
    vi.mocked(extractStructuredData).mockResolvedValue({
      success: true,
      data: { name: 'extracted' },
      outputPath: path.join(projectDir, '.aiex', 'extracted', 'test_table-result.json'),
    })
    vi.mocked(insertExtractedData).mockReturnValue({
      success: true,
      tablesInserted: [{ table: 'test_table', rowId: 1 }],
    })

    // 3rd batch run with force: should process both files again
    await cmd.run({ args: { schema: 'test_schema', dir: batchDir, force: true } })
    expect(process.exitCode).toBe(0)
    expect(extractStructuredData).toHaveBeenCalledTimes(2) // processes both again
  })
})
