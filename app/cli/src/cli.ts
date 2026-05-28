import process from 'node:process'
import { defineCommand, runMain } from 'citty'
import { consola } from 'consola'
import updateNotifier from 'update-notifier'
import { subCommands } from '@/commands'
import { createConfig, seedConfig } from '@/config'
import { initI18n } from '@/locales'
import pkg from '~/package.json'

await initI18n()

const config = createConfig()
seedConfig(config)

updateNotifier({ pkg: pkg as any }).notify()

process.on('uncaughtException', (error) => {
  consola.error(error)
  process.exit(1)
})

process.on('unhandledRejection', (reason) => {
  const error = reason instanceof Error ? reason : new Error(String(reason))
  consola.error(error)
  process.exit(1)
})

// Handle internal _complete command before citty processes args
if (process.argv[2] === '_complete') {
  const { getCompletions } = await import('@/infrastructure/completion/completions')
  const args = process.argv.slice(4)
  const suggestions = getCompletions(subCommands as unknown as Record<string, unknown>, args)
  for (const s of suggestions)
    process.stdout.write(`${s}\n`)
  process.exit(0)
}

const main = defineCommand({
  meta: {
    name: pkg.name,
    version: pkg.version,
    description: pkg.description,
  },
  subCommands,
})

runMain(main)
