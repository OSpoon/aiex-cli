import process from 'node:process'
import { intro, spinner } from '@clack/prompts'
import { defineCommand } from 'citty'
import { consola } from 'consola'
import pc from 'picocolors'
import { createMigrationConfig } from '@/infrastructure/schema/migration-config'
import { startWebServer } from '@/infrastructure/web/web-server'
import { initI18n, t } from '@/locales'

export const webCommand = defineCommand({
  meta: {
    name: 'web',
    description: t('command.web.description'),
  },
  args: {
    port: {
      type: 'string',
      alias: 'p',
      description: t('command.web.args.port'),
      default: '13000',
    },
  },
  async run({ args }) {
    await initI18n()
    intro(pc.inverse(' aiex web '))

    const cwd = process.cwd()
    const port = Number(args.port) || 13000
    const config = createMigrationConfig(cwd)

    const s = spinner()
    s.start(t('command.web.starting'))

    await startWebServer({
      config,
      port,
      onStarted(info) {
        s.stop(t('command.web.serverRunning', { url: pc.cyan(info.url) }))
        consola.info(t('command.web.schemaDir', { path: pc.dim(info.schemaPath) }))
        consola.info(t('command.web.pressCtrlC'))
      },
      onOpenFailed(url) {
        consola.warn(t('command.web.browserOpenFailed', { url }))
      },
    })
  },
})
