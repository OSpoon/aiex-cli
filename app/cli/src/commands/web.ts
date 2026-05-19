import process from 'node:process'
import { intro, spinner } from '@clack/prompts'
import { defineCommand } from 'citty'
import { consola } from 'consola'
import pc from 'picocolors'
import { createMigrationConfig } from '@/core/schema-sqlite'
import { startWebServer } from '@/core/web-runner'

export const webCommand = defineCommand({
  meta: {
    name: 'web',
    description: 'Start visual JSON Schema editor',
  },
  args: {
    port: {
      type: 'string',
      alias: 'p',
      description: 'Port to listen on',
      default: '13000',
    },
  },
  async run({ args }) {
    intro(pc.inverse(' aiex web '))

    const cwd = process.cwd()
    const port = Number(args.port) || 13000
    const config = createMigrationConfig(cwd)

    const s = spinner()
    s.start('Starting web server...')

    await startWebServer({
      config,
      port,
      onStarted(info) {
        s.stop(`Server running at ${pc.cyan(info.url)}`)
        consola.info(`Schema directory: ${pc.dim(info.schemaPath)}`)
        consola.info('Press Ctrl+C to stop')
      },
      onOpenFailed(url) {
        consola.warn(`Could not open browser. Visit ${url} manually.`)
      },
    })
  },
})
