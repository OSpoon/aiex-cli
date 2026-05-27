import process from 'node:process'
import { describe, expect, it, vi } from 'vitest'
import { completionCommand } from '@/commands/completion'

vi.mock('@/core/completion-scripts', () => ({
  generateCompletionScript: vi.fn((name, shell) => {
    if (shell !== 'bash' && shell !== 'zsh' && shell !== 'fish')
      throw new Error(`Unsupported shell: ${shell}. Use bash, zsh, or fish.`)
    return `# ${name} ${shell} completion script`
  }),
}))

const cmd = completionCommand as any

describe('completionCommand definition', () => {
  it('should have correct meta name and description', () => {
    expect(cmd.meta.name).toBe('completion')
    expect(cmd.meta.description).toContain('Generate shell completion scripts')
  })

  it('should define shell arg as required positional', () => {
    expect(cmd.args.shell).toBeDefined()
    expect(cmd.args.shell.type).toBe('positional')
    expect(cmd.args.shell.required).toBe(true)
  })
})

describe('completionCommand.run', () => {
  it('should write completion script to stdout for valid shell', async () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    await cmd.run({ args: { shell: 'bash' } })

    expect(writeSpy).toHaveBeenCalledWith('# aiex bash completion script')

    writeSpy.mockRestore()
  })

  it('should write error to stderr and exit for unsupported shell', async () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)

    await cmd.run({ args: { shell: 'invalid' } })

    expect(stderrSpy).toHaveBeenCalled()
    expect(exitSpy).toHaveBeenCalledWith(1)

    stderrSpy.mockRestore()
    exitSpy.mockRestore()
  })
})
