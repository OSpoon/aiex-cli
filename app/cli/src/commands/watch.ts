import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { intro } from '@clack/prompts'
import { defineCommand } from 'citty'
import { consola } from 'consola'
import pc from 'picocolors'
import { loadConfiguredAI, resolveModelOverride } from '@/commands/extract'
import { failCommand } from '@/commands/utils'
import { loadSchema } from '@/core/extract-runner'
import { createMigrationConfig } from '@/core/schema-sqlite'
import { startWatcher } from '@/core/watch-service'

export const watchCommand = defineCommand({
  meta: {
    name: 'watch',
    description: 'Watch a directory for new files and automatically extract data',
  },
  args: {
    schema: {
      type: 'string',
      alias: 's',
      description: 'Schema name (without .json extension) to use for extraction',
    },
    dir: {
      type: 'string',
      alias: 'd',
      description: 'Directory path to watch for incoming files',
    },
    model: {
      type: 'string',
      alias: 'm',
      description: 'AI model to use for extraction (overrides default/auto-selected model)',
    },
    noInsert: {
      type: 'boolean',
      description: 'Extract and save JSON without inserting into SQLite database',
      default: false,
    },
  },
  async run({ args }) {
    intro(pc.inverse(' aiex watch '))

    if (!args.schema) {
      failCommand('Schema name (-s) is required')
      return
    }

    if (!args.dir) {
      failCommand('Watch directory path (-d) is required')
      return
    }

    const cwd = process.cwd()
    const config = createMigrationConfig(cwd)
    const aiexDir = path.dirname(config.schemaPath)

    // Verify schema exists
    const schemaLoad = await loadSchema(config, args.schema)
    if (!schemaLoad.schema) {
      failCommand(schemaLoad.error || `Schema file for "${args.schema}" not found`)
      return
    }

    // Verify watch directory exists and is a directory
    let watchDirStat: fs.Stats
    try {
      watchDirStat = fs.statSync(args.dir)
    }
    catch (e) {
      failCommand(`Watch directory does not exist: ${args.dir} — ${e instanceof Error ? e.message : String(e)}`)
      return
    }

    if (!watchDirStat.isDirectory()) {
      failCommand(`Watch path is not a directory: ${args.dir}`)
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
      consola.info('\nStopping watch directory daemon...')
      await watcher.close()
      consola.success('Daemon stopped.')
      process.exit(0)
    }

    process.on('SIGINT', cleanup)
    process.on('SIGTERM', cleanup)

    consola.info('Press Ctrl+C to stop')
  },
})
