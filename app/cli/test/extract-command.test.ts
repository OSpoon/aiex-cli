import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { intro, outro } from '@clack/prompts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { extractStructuredData } from '@/application/ai-extraction/extract-structured-data'
import { SUPPORTED_FILE_TYPES_TEXT } from '@/application/input/file-policy'
import { extractCommand } from '@/commands/extract'
import { readAIConfig } from '@/infrastructure/ai/ai-config-store'
import { insertExtractedData } from '@/infrastructure/extraction/insert-extracted-data'

// Force English locale for deterministic test output
vi.stubEnv('LANG', 'en_US.UTF-8')

// —— vitest mocks ——
vi.mock('@/application/ai-extraction/extract-structured-data', () => ({
  extractStructuredData: vi.fn(),
}))

vi.mock('@/infrastructure/extraction/insert-extracted-data', () => ({
  insertExtractedData: vi.fn(),
}))

vi.mock('@/infrastructure/ai/ai-config-store', () => ({
  readAIConfig: vi.fn(),
}))

vi.mock('@clack/prompts', () => ({
  confirm: vi.fn(),
  intro: vi.fn(),
  outro: vi.fn(),
  isCancel: vi.fn(() => false),
  select: vi.fn(),
  spinner: vi.fn(() => ({ start: vi.fn(), stop: vi.fn() })),
  text: vi.fn(),
}))

vi.mock('@/infrastructure/pdf', () => ({
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
const cleanupDirs = new Set<string>()

function cleanupDir(dir: string): void {
  if (path.resolve(process.cwd()).toLowerCase() === path.resolve(dir).toLowerCase())
    process.chdir(originalCwd)
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  cleanupDirs.delete(dir)
}

function createProjectFixture(): string {
  const dir = path.join(os.tmpdir(), `test-extract-project-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  cleanupDirs.add(dir)
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

  it('should describe supported file types from the shared file constants', () => {
    expect(cmd.args.file.description).toContain(`Supported: ${SUPPORTED_FILE_TYPES_TEXT}.`)
  })
})

describe('extractCommand.run', () => {
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

  it('should fail when combining --dir and --file', async () => {
    await cmd.run({ args: { dir: os.tmpdir(), file: path.join(os.tmpdir(), 'test.txt') } })
    expect(process.exitCode).toBe(1)
  })

  it('should not enter interactive extraction after a subcommand runs', async () => {
    await cmd.run({ rawArgs: ['history'], args: {} })

    expect(intro).not.toHaveBeenCalled()
    expect(readAIConfig).not.toHaveBeenCalled()
  })

  it('should fail without crash for empty batch directory', async () => {
    const dir = path.join(os.tmpdir(), `test-extract-empty-${Date.now()}`)
    fs.mkdirSync(dir, { recursive: true })

    mockAIConfig()

    await cmd.run({ args: { dir, schema: 'test' } })
    expect(process.exitCode).toBe(1)

    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })

  it('should fail gracefully for nonexistent batch directory', async () => {
    const dir = path.join(os.tmpdir(), `test-extract-nonexistent-${Date.now()}`)

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

    cleanupDir(projectDir)
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

    cleanupDir(projectDir)
  })

  it('should save extraction without inserting when --no-insert is used', async () => {
    const projectDir = createProjectFixture()
    process.chdir(projectDir)

    const inputFile = path.join(projectDir, 'sample.txt')
    fs.writeFileSync(inputFile, 'Alice is 30')

    mockAIConfig()
    vi.mocked(extractStructuredData).mockResolvedValue({
      success: true,
      data: { name: 'Alice' },
      outputPath: path.join(projectDir, '.aiex', 'extracted', 'test_table-result.json'),
    })

    await cmd.run({ args: { schema: 'test', file: inputFile, noInsert: true } })

    expect(process.exitCode).toBe(0)
    expect(insertExtractedData).not.toHaveBeenCalled()

    const auditDir = path.join(projectDir, '.aiex', 'extracted', '_audit')
    const auditFiles = fs.readdirSync(auditDir)
    expect(auditFiles).toHaveLength(1)
    const audit = JSON.parse(fs.readFileSync(path.join(auditDir, auditFiles[0]), 'utf-8'))
    expect(audit).toMatchObject({
      status: 'succeeded',
      schemaName: 'test',
      source: { type: 'file', filePath: inputFile },
      outputName: 'test_table-result.json',
    })

    cleanupDir(projectDir)
  })

  it('should delete audit record and cached upload through extract rm', async () => {
    const projectDir = createProjectFixture()
    process.chdir(projectDir)

    const auditDir = path.join(projectDir, '.aiex', 'extracted', '_audit')
    const uploadsDir = path.join(projectDir, '.aiex', 'uploads')
    const uploadPath = path.join(uploadsDir, 'run-1-source.txt')
    fs.mkdirSync(auditDir, { recursive: true })
    fs.mkdirSync(uploadsDir, { recursive: true })
    fs.writeFileSync(uploadPath, 'Alice')
    fs.writeFileSync(path.join(auditDir, 'run-1.json'), JSON.stringify({
      id: 'run-1',
      status: 'failed',
      schemaName: 'test',
      source: { type: 'file', filePath: uploadPath, fileName: 'source.txt' },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }))

    await cmd.subCommands.rm.run({ args: { id: 'run-1' } })

    expect(process.exitCode).toBe(0)
    expect(fs.existsSync(path.join(auditDir, 'run-1.json'))).toBe(false)
    expect(fs.existsSync(uploadPath)).toBe(false)

    cleanupDir(projectDir)
  })

  it('should run interactive mode for single file with force flag', async () => {
    const projectDir = createProjectFixture()
    process.chdir(projectDir)

    const inputFile = path.join(projectDir, 'sample.txt')
    fs.writeFileSync(inputFile, 'Bob is 25')

    mockAIConfig()
    const { select, text, confirm } = await import('@clack/prompts')
    vi.mocked(select)
      .mockResolvedValueOnce('test') // select schema
      .mockResolvedValueOnce('file') // select chooseSource
    vi.mocked(text).mockResolvedValueOnce(inputFile) // enter file path
    vi.mocked(confirm).mockResolvedValueOnce(true) // askForce confirm

    vi.mocked(extractStructuredData).mockResolvedValue({
      success: true,
      data: { name: 'Bob' },
      outputPath: path.join(projectDir, '.aiex', 'extracted', 'test_table-result.json'),
    })

    await cmd.run({ args: {} })

    expect(process.exitCode).toBe(0)
    expect(extractStructuredData).toHaveBeenCalled()
    expect(outro).toHaveBeenCalledWith('Done!')

    cleanupDir(projectDir)
  })

  it('should cancel interactive mode when schema selection is cancelled', async () => {
    const projectDir = createProjectFixture()
    process.chdir(projectDir)

    mockAIConfig()
    const { select, isCancel } = await import('@clack/prompts')
    vi.mocked(select).mockResolvedValueOnce('test')
    vi.mocked(isCancel).mockReturnValueOnce(true) // for schemaName check

    await cmd.run({ args: {} })

    expect(outro).toHaveBeenCalledWith('Cancelled')
    cleanupDir(projectDir)
  })

  it('should cancel interactive mode when input source selection is cancelled', async () => {
    const projectDir = createProjectFixture()
    process.chdir(projectDir)

    mockAIConfig()
    const { select, isCancel } = await import('@clack/prompts')
    vi.mocked(select)
      .mockResolvedValueOnce('test')
      .mockResolvedValueOnce('file')
    vi.mocked(isCancel)
      .mockReturnValueOnce(false) // schemaName check
      .mockReturnValueOnce(true) // inputSource check

    await cmd.run({ args: {} })

    expect(outro).toHaveBeenCalledWith('Cancelled')
    cleanupDir(projectDir)
  })

  it('should cancel interactive mode when file path input is cancelled', async () => {
    const projectDir = createProjectFixture()
    process.chdir(projectDir)

    mockAIConfig()
    const { select, text, isCancel } = await import('@clack/prompts')
    vi.mocked(select)
      .mockResolvedValueOnce('test')
      .mockResolvedValueOnce('file')
    vi.mocked(text).mockResolvedValueOnce('path')
    vi.mocked(isCancel)
      .mockReturnValueOnce(false) // schemaName check
      .mockReturnValueOnce(false) // inputSource check
      .mockReturnValueOnce(true) // filePathStr check

    await cmd.run({ args: {} })

    expect(outro).toHaveBeenCalledWith('Cancelled')
    cleanupDir(projectDir)
  })

  it('should cancel interactive mode when force confirm is cancelled', async () => {
    const projectDir = createProjectFixture()
    process.chdir(projectDir)

    mockAIConfig()
    const { select, text, confirm, isCancel } = await import('@clack/prompts')
    vi.mocked(select)
      .mockResolvedValueOnce('test')
      .mockResolvedValueOnce('file')
    vi.mocked(text).mockResolvedValueOnce('path')
    vi.mocked(confirm).mockResolvedValueOnce(true)
    vi.mocked(isCancel)
      .mockReturnValueOnce(false) // schemaName check
      .mockReturnValueOnce(false) // inputSource check
      .mockReturnValueOnce(false) // filePathStr check
      .mockReturnValueOnce(true) // force check

    await cmd.run({ args: {} })

    expect(outro).toHaveBeenCalledWith('Cancelled')
    cleanupDir(projectDir)
  })

  it('should run interactive mode for batch directory with force flag', async () => {
    const projectDir = createProjectFixture()
    const inputDir = path.join(projectDir, 'inputs')
    fs.mkdirSync(inputDir)
    fs.writeFileSync(path.join(inputDir, 'one.txt'), 'one')
    process.chdir(projectDir)

    mockAIConfig()
    const { select, text, confirm } = await import('@clack/prompts')
    vi.mocked(select)
      .mockResolvedValueOnce('test') // select schema
      .mockResolvedValueOnce('dir') // select chooseSource
    vi.mocked(text).mockResolvedValueOnce(inputDir) // enter dir path
    vi.mocked(confirm).mockResolvedValueOnce(true) // askForce confirm

    vi.mocked(extractStructuredData).mockResolvedValue({
      success: true,
      data: { name: 'one' },
    })

    await cmd.run({ args: {} })

    expect(process.exitCode).toBe(0)
    expect(extractStructuredData).toHaveBeenCalled()
    expect(outro).toHaveBeenCalledWith('Done!')

    cleanupDir(projectDir)
  })
})
