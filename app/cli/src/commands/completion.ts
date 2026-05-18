import process from 'node:process'
import { defineCommand } from 'citty'

function bashScript(name: string): string {
  return `# ${name} bash completion
_${name}() {
  local IFS=\\$'\\n'
  COMPREPLY=($(${name} _complete "\${COMP_WORDS[@]}" 2>/dev/null))
}
complete -F _${name} ${name}
`
}

function zshScript(name: string): string {
  return `# ${name} zsh completion
#compdef ${name}

_${name}() {
  local -a completions
  completions=("\${(@f)$(${name} _complete "\${words[@]}" 2>/dev/null)}")
  _describe '${name}' completions
}
compdef _${name} ${name}
`
}

function fishScript(name: string): string {
  return `# ${name} fish completion
complete -c ${name} -f -a '(${name} _complete (commandline -cp) 2>/dev/null)'
`
}

export { bashScript, fishScript, zshScript }

function generateScript(name: string, shell: string): string {
  switch (shell) {
    case 'bash':
      return bashScript(name)
    case 'zsh':
      return zshScript(name)
    case 'fish':
      return fishScript(name)
    default:
      throw new Error(`Unsupported shell: ${shell}. Use bash, zsh, or fish.`)
  }
}

export const completionCommand = defineCommand({
  meta: {
    name: 'completion',
    description: 'Generate shell completion scripts (bash|zsh|fish)\n\nUsage:\n  aiex completion bash  # source <(aiex completion bash)\n  aiex completion zsh   # source <(aiex completion zsh)\n  aiex completion fish  # aiex completion fish | source',
  },
  args: {
    shell: {
      type: 'string',
      description: 'Shell type: bash, zsh, fish',
      required: true,
    },
  },
  async run({ args }) {
    const name = 'aiex'
    const shell = args.shell as string

    try {
      process.stdout.write(generateScript(name, shell))
    }
    catch (error) {
      process.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`)
      process.exit(1)
    }
  },
})
