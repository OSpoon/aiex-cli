import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { schemaCommand } from '@/commands/schema'

vi.mock('@clack/prompts', () => ({
  intro: vi.fn(),
  outro: vi.fn(),
  spinner: vi.fn(() => ({ start: vi.fn(), stop: vi.fn() })),
}))

const cmd = schemaCommand as any
const originalCwd = process.cwd()

describe('schemaCommand definition', () => {
  it('should have correct meta name and description', () => {
    expect(cmd.meta.name).toBe('schema')
    expect(cmd.meta.description).toBe('Sync JSON Schema to SQLite database')
  })

  it('should define generate and name args', () => {
    expect(cmd.args.generate).toBeDefined()
    expect(cmd.args.generate.type).toBe('boolean')
    expect(cmd.args.generate.alias).toBe('g')
    expect(cmd.args.name).toBeDefined()
    expect(cmd.args.name.type).toBe('string')
  })
})

describe('schemaCommand.run', () => {
  let projectDir: string

  beforeEach(() => {
    projectDir = path.join(os.tmpdir(), `test-schema-cmd-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    fs.mkdirSync(path.join(projectDir, '.aiex', 'schema'), { recursive: true })
    process.exitCode = 0
  })

  afterEach(() => {
    process.exitCode = 0
    process.chdir(originalCwd)
    fs.rmSync(projectDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })

  it('should fail when no schema files exist', async () => {
    process.chdir(projectDir)
    await cmd.run({ args: {} })
    expect(process.exitCode).toBe(1)
  })

  it('should pass when schema files exist and generate succeeds', async () => {
    process.chdir(projectDir)
    fs.writeFileSync(path.join(projectDir, '.aiex', 'schema', 'test.json'), JSON.stringify({
      title: 'Test',
      type: 'object',
      table: { name: 'test' },
      properties: { id: { type: 'integer', primary: true } },
    }))

    await cmd.run({ args: { generate: true } })
    expect(process.exitCode).toBe(0)
  })

  it('should handle invalid JSON schema gracefully', async () => {
    process.chdir(projectDir)
    fs.writeFileSync(path.join(projectDir, '.aiex', 'schema', 'bad.json'), 'not json')

    await cmd.run({ args: { generate: true } })
    expect(process.exitCode).toBe(1)
  })
})
