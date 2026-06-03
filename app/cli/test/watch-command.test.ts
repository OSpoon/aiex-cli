import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { watchCommand } from '@/commands/watch'

vi.mock('@clack/prompts', () => ({
  confirm: vi.fn(),
  intro: vi.fn(),
  isCancel: vi.fn(() => false),
  outro: vi.fn(),
  select: vi.fn(),
  text: vi.fn(),
}))

vi.mock('@/application/watch/watch-service', () => ({
  startWatcher: vi.fn(() => ({ close: vi.fn() })),
}))

vi.mock('@/application/schema/load-schema', () => ({
  listSchemas: vi.fn(),
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

  it('should enter guided mode when no args are provided', async () => {
    process.chdir(projectDir)
    const watchDir = path.join(projectDir, 'watch')
    fs.mkdirSync(watchDir)

    const { select, text, confirm } = await import('@clack/prompts')
    const { listSchemas } = await import('@/application/schema/load-schema')
    const { loadConfiguredAI, resolveModelOverride } = await import('@/commands/extract')
    const { startWatcher } = await import('@/application/watch/watch-service')

    vi.mocked(listSchemas).mockResolvedValueOnce(['test'])
    vi.mocked(loadConfiguredAI).mockResolvedValueOnce({
      provider: {
        apiKey: 'test-key',
        baseURL: 'https://example.com',
        models: [{ name: 'gpt-4o-mini' }],
      },
      extraction: {} as any,
    } as any)
    vi.mocked(select)
      .mockResolvedValueOnce('test')
      .mockResolvedValueOnce('')
    vi.mocked(text).mockResolvedValueOnce(watchDir)
    vi.mocked(confirm).mockResolvedValueOnce(false)
    vi.mocked(resolveModelOverride).mockReturnValueOnce(undefined)

    await cmd.run({ args: {} })

    expect(process.exitCode).toBe(0)
    expect(startWatcher).toHaveBeenCalledWith(expect.objectContaining({
      schemaName: 'test',
      watchDir,
      insert: true,
    }))
  })

  it('should fail when schema arg is missing in non-interactive mode', async () => {
    process.chdir(projectDir)
    await cmd.run({ args: { dir: projectDir } })
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
