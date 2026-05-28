import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { intro } from '@clack/prompts'
import { defineCommand } from 'citty'
import { consola } from 'consola'
import pc from 'picocolors'
import { loadSchema } from '@/application/schema/load-schema'
import { startWatcher } from '@/application/watch/watch-service'
import { loadConfiguredAI, resolveModelOverride } from '@/commands/extract'
import { failCommand } from '@/commands/utils'
import { createMigrationConfig } from '@/infrastructure/schema/migration-config'
import { initI18n, t } from '@/locales'

export const watchCommand = defineCommand({
  meta: {
    name: 'watch',
    description: t('command.watch.description'),
  },
  args: {
    schema: {
      type: 'string',
      alias: 's',
      description: t('command.watch.args.schema'),
    },
    dir: {
      type: 'string',
      alias: 'd',
      description: t('command.watch.args.dir'),
    },
    model: {
      type: 'string',
      alias: 'm',
      description: t('command.watch.args.model'),
    },
    noInsert: {
      type: 'boolean',
      description: t('command.watch.args.noInsert'),
      default: false,
    },
  },
  async run({ args }) {
    intro(pc.inverse(' aiex watch '))
    await initI18n()

    if (!args.schema) {
      failCommand(t('command.watch.errors.schemaRequired'))
      return
    }

    if (!args.dir) {
      failCommand(t('command.watch.errors.dirRequired'))
      return
    }

    const cwd = process.cwd()
    const config = createMigrationConfig(cwd)
    const aiexDir = path.dirname(config.schemaPath)

    // Verify schema exists
    const schemaLoad = await loadSchema(config, args.schema)
    if (!schemaLoad.schema) {
      failCommand(schemaLoad.error || t('command.watch.errors.schemaNotFound', { name: args.schema }))
      return
    }

    // Verify watch directory exists and is a directory
    let watchDirStat: fs.Stats
    try {
      watchDirStat = fs.statSync(args.dir)
    }
    catch (e) {
      failCommand(t('command.watch.errors.dirNotExist', { dir: args.dir, error: e instanceof Error ? e.message : String(e) }))
      return
    }

    if (!watchDirStat.isDirectory()) {
      failCommand(t('command.watch.errors.notADirectory', { dir: args.dir }))
      return
    }

    const watchDirAbs = path.resolve(args.dir)

    // Load AI configurations
    const aiConfig = await loadConfiguredAI(aiexDir)
    if (!aiConfig)
      return

    // Resolve model override
    const modelOverride = resolveModelOverride(aiConfig, args.model)
    if (modelOverride === null)
      return

    // Start watching
    const watcher = startWatcher({
      aiexDir,
      config,
      aiConfig,
      schemaName: args.schema,
      watchDir: watchDirAbs,
      modelOverride,
      insert: !args.noInsert,
    })

    const cleanup = async (): Promise<void> => {
      consola.info(t('command.watch.events.stopped'))
      await watcher.close()
      consola.success(t('command.watch.events.stoppedOk'))
      process.exit(0)
    }

    process.on('SIGINT', cleanup)
    process.on('SIGTERM', cleanup)

    consola.info(t('command.watch.events.pressCtrlC'))
  },
})
