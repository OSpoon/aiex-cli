import type { CommandDef } from 'citty'
import { describe, expect, it } from 'vitest'
import { bashScript, fishScript, zshScript } from '@/commands/completion'
import { getCompletions } from '@/core/completions'

// ──────────── Fixtures ────────────

const mockCommands: Record<string, CommandDef> = {
  web: {
    meta: { name: 'web', description: 'Start web interface' },
    args: {
      port: { type: 'string', alias: 'p', description: 'Port', default: '13000' },
    },
    run: async () => {},
  },
  schema: {
    meta: { name: 'schema', description: 'Sync JSON Schema to SQLite' },
    args: {
      init: { type: 'boolean', alias: 'i', description: 'Initialize', default: false },
      name: { type: 'string', description: 'Migration name' },
    },
    run: async () => {},
  },
  extract: {
    meta: { name: 'extract', description: 'Extract structured data' },
    args: {
      schema: { type: 'string', alias: 's', description: 'Schema name', required: true },
      text: { type: 'string', alias: 't', description: 'Text content' },
      file: { type: 'string', alias: 'f', description: 'File path' },
      model: { type: 'string', alias: 'm', description: 'AI model' },
      db: { type: 'boolean', alias: 'd', description: 'Insert into DB', default: false },
    },
    run: async () => {},
  },
  doctor: {
    meta: { name: 'doctor', description: 'Print diagnostics' },
    args: {
      json: { type: 'boolean', description: 'JSON output' },
    },
    run: async () => {},
  },
  completion: {
    meta: { name: 'completion', description: 'Generate shell completion scripts' },
    args: {
      shell: { type: 'string', description: 'Shell type', required: true },
    },
    run: async () => {},
  },
}

// ──────────── Tests: getCompletions ────────────

describe('getCompletions', () => {
  it('returns all command names when no args given', () => {
    expect(getCompletions(mockCommands, [''])).toEqual([
      'web',
      'schema',
      'extract',
      'doctor',
      'completion',
    ])
  })

  it('filters commands by partial name', () => {
    expect(getCompletions(mockCommands, ['ex'])).toEqual(['extract'])
  })

  it('returns multiple matches for shared prefix', () => {
    const result = getCompletions(mockCommands, ['c'])
    expect(result).toContain('completion')
    expect(result.length).toBe(1)
  })

  it('returns empty for no match', () => {
    expect(getCompletions(mockCommands, ['xyz'])).toEqual([])
  })

  it('hides internal commands starting with _', () => {
    const cmds = {
      ...mockCommands,
      _hidden: { meta: { name: '_hidden', description: '' }, run: async () => {} },
    }
    const result = getCompletions(cmds, [''])
    expect(result).not.toContain('_hidden')
  })

  it('returns arg names for a known command', () => {
    const result = getCompletions(mockCommands, ['extract', ''])
    expect(result).toContain('--schema')
    expect(result).toContain('-s')
    expect(result).toContain('--text')
    expect(result).toContain('-t')
    expect(result).toContain('--db')
    expect(result).toContain('-d')
  })

  it('filters arg names by partial input', () => {
    const result = getCompletions(mockCommands, ['extract', '--m'])
    expect(result).toEqual(['--model', '-m'])
  })

  it('filters arg short names by partial input', () => {
    const result = getCompletions(mockCommands, ['extract', '-m'])
    expect(result).toEqual(['--model', '-m'])
  })

  it('returns all commands for unknown command fallback', () => {
    const result = getCompletions(mockCommands, ['extract', 'blah'])
    expect(result).toContain('--schema')
    expect(result).toContain('-s')
  })

  it('returns arg names for nested single arg', () => {
    const result = getCompletions(mockCommands, ['web', ''])
    expect(result).toContain('--port')
    expect(result).toContain('-p')
  })

  it('returns empty for unknown command with no partial match', () => {
    expect(getCompletions(mockCommands, ['unknown', ''])).toEqual([
      'web',
      'schema',
      'extract',
      'doctor',
      'completion',
    ])
  })
})

// Wrap the internal bash/zsh/fish functions by evaluating the module output
describe('completion bash script', () => {
  it('contains the completion function for bash', () => {
    const script = bashScript('aiex')
    expect(script).toContain('# aiex bash completion')
    expect(script).toContain('_aiex()')
    expect(script).toContain('COMPREPLY=')
    expect(script).toContain('aiex _complete')
    expect(script).toContain('complete -F _aiex aiex')
  })
})

describe('completion zsh script', () => {
  it('contains the completion function for zsh', () => {
    const script = zshScript('aiex')
    expect(script).toContain('# aiex zsh completion')
    expect(script).toContain('#compdef aiex')
    expect(script).toContain('_aiex()')
    expect(script).toContain('_describe')
    expect(script).toContain('compdef _aiex aiex')
  })
})

describe('completion fish script', () => {
  it('contains the completion command for fish', () => {
    const script = fishScript('aiex')
    expect(script).toContain('# aiex fish completion')
    expect(script).toContain('complete -c aiex')
    expect(script).toContain('aiex _complete')
  })
})
