import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@clack/prompts', () => ({
  intro: vi.fn(),
  spinner: vi.fn(() => ({ start: vi.fn(), stop: vi.fn() })),
}))

vi.mock('@/infrastructure/web/web-server', () => ({
  startWebServer: vi.fn(),
}))

const cmd = (await import('@/commands/web')).webCommand as any
const originalCwd = process.cwd()

describe('webCommand definition', () => {
  it('should have correct meta name and description', () => {
    expect(cmd.meta.name).toBe('web')
    expect(cmd.meta.description).toBe('Start visual JSON Schema editor')
  })

  it('should define port arg with default 13000', () => {
    expect(cmd.args.port).toBeDefined()
    expect(cmd.args.port.type).toBe('string')
    expect(cmd.args.port.alias).toBe('p')
    expect(cmd.args.port.default).toBe('13000')
  })
})

describe('webCommand.run', () => {
  let projectDir: string

  beforeEach(() => {
    projectDir = path.join(os.tmpdir(), `test-web-cmd-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    fs.mkdirSync(path.join(projectDir, '.aiex', 'schema'), { recursive: true })
    process.exitCode = 0
  })

  afterEach(() => {
    process.exitCode = 0
    process.chdir(originalCwd)
    fs.rmSync(projectDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    vi.clearAllMocks()
  })

  it('should start web server with default port', async () => {
    process.chdir(projectDir)
    const { startWebServer } = await import('@/infrastructure/web/web-server')

    await cmd.run({ args: {} })

    expect(startWebServer).toHaveBeenCalledOnce()
    const callArgs = vi.mocked(startWebServer).mock.calls[0][0]
    expect(callArgs.port).toBe(13000)
  })

  it('should start web server with custom port', async () => {
    process.chdir(projectDir)
    const { startWebServer } = await import('@/infrastructure/web/web-server')

    await cmd.run({ args: { port: '14000' } })

    expect(startWebServer).toHaveBeenCalledOnce()
    const callArgs = vi.mocked(startWebServer).mock.calls[0][0]
    expect(callArgs.port).toBe(14000)
  })

  it('should fallback to default port when port is NaN', async () => {
    process.chdir(projectDir)
    const { startWebServer } = await import('@/infrastructure/web/web-server')

    await cmd.run({ args: { port: 'not-a-number' } })

    expect(startWebServer).toHaveBeenCalledOnce()
    const callArgs = vi.mocked(startWebServer).mock.calls[0][0]
    expect(callArgs.port).toBe(13000)
  })
})
