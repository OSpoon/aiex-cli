import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { watchCommand } from '@/commands/watch'

vi.mock('@clack/prompts', () => ({
  intro: vi.fn(),
  outro: vi.fn(),
}))

vi.mock('@/application/watch/watch-service', () => ({
  startWatcher: vi.fn(() => ({ close: vi.fn() })),
}))

vi.mock('@/application/schema/load-schema', () => ({
  loadSchema: vi.fn(),
}))

vi.mock('@/commands/extract', () => ({
  loadConfiguredAI: vi.fn(),
  resolveModelOverride: vi.fn(),
}))

const cmd = watchCommand as any
const originalCwd = process.cwd()

describe('watchCommand definition', () => {
  it('should have correct meta name and description', () => {
    expect(cmd.meta.name).toBe('watch')
    expect(cmd.meta.description).toBe('Watch a directory for new files and automatically extract data')
  })

  it('should define schema, dir, model, noInsert args', () => {
    expect(cmd.args.schema).toBeDefined()
    expect(cmd.args.schema.alias).toBe('s')
    expect(cmd.args.dir).toBeDefined()
    expect(cmd.args.dir.alias).toBe('d')
    expect(cmd.args.model).toBeDefined()
    expect(cmd.args.model.alias).toBe('m')
    expect(cmd.args.noInsert).toBeDefined()
    expect(cmd.args.noInsert.type).toBe('boolean')
  })
})

describe('watchCommand.run', () => {
  let projectDir: string

  beforeEach(() => {
    projectDir = path.join(os.tmpdir(), `test-watch-cmd-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    fs.mkdirSync(path.join(projectDir, '.aiex', 'schema'), { recursive: true })
    process.exitCode = 0
  })

  afterEach(() => {
    process.exitCode = 0
    process.chdir(originalCwd)
    fs.rmSync(projectDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    vi.clearAllMocks()
  })

  it('should fail when schema arg is missing', async () => {
    process.chdir(projectDir)
    await cmd.run({ args: {} })
    expect(process.exitCode).toBe(1)
  })

  it('should fail when dir arg is missing', async () => {
    process.chdir(projectDir)
    await cmd.run({ args: { schema: 'test' } })
    expect(process.exitCode).toBe(1)
  })

  it('should fail when schema file does not exist', async () => {
    process.chdir(projectDir)
    const { loadSchema } = await import('@/application/schema/load-schema')
    vi.mocked(loadSchema).mockResolvedValueOnce({ schema: null, error: 'Schema not found' })

    const watchDir = path.join(projectDir, 'watch')
    fs.mkdirSync(watchDir)

    await cmd.run({ args: { schema: 'nonexistent', dir: watchDir } })
    expect(process.exitCode).toBe(1)
  })

  it('should fail when watch dir does not exist', async () => {
    process.chdir(projectDir)
    const { loadSchema } = await import('@/application/schema/load-schema')
    vi.mocked(loadSchema).mockResolvedValueOnce({ schema: { title: 'Test' }, error: undefined })

    await cmd.run({ args: { schema: 'test', dir: '/nonexistent/dir' } })
    expect(process.exitCode).toBe(1)
  })

  it('should fail when watch dir is a file', async () => {
    process.chdir(projectDir)
    const { loadSchema } = await import('@/application/schema/load-schema')
    vi.mocked(loadSchema).mockResolvedValueOnce({ schema: { title: 'Test' }, error: undefined })

    const filePath = path.join(projectDir, 'not-a-dir.txt')
    fs.writeFileSync(filePath, 'not a dir')

    await cmd.run({ args: { schema: 'test', dir: filePath } })
    expect(process.exitCode).toBe(1)
  })
})
