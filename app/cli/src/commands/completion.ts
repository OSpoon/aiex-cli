import process from 'node:process'
import { defineCommand } from 'citty'
import { generateCompletionScript } from '@/core/completion-scripts'

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
      process.stdout.write(generateCompletionScript(name, shell))
    }
    catch (error) {
      process.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`)
      process.exit(1)
    }
  },
})
