import process from 'node:process'
import { defineCommand } from 'citty'
import { generateCompletionScript } from '@/core/completion-scripts'
import { t } from '@/locales'

export const completionCommand = defineCommand({
  meta: {
    name: 'completion',
    description: t('command.completion.description'),
  },
  args: {
    shell: {
      type: 'positional',
      description: t('command.completion.args.shell'),
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
      process.stderr.write(`${t('command.completion.error', { error: error instanceof Error ? error.message : String(error) })}\n`)
      process.exit(1)
    }
  },
})
