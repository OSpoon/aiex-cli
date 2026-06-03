import type { AIConfig, AIModelConfig } from '@/domain/ai/types'
import type { MigrationConfig } from '@/domain/schema/types'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { confirm, intro, isCancel, outro, select, text } from '@clack/prompts'
import { defineCommand } from 'citty'
import { consola } from 'consola'
import pc from 'picocolors'
import { listSchemas, loadSchema } from '@/application/schema/load-schema'
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

    const cwd = process.cwd()
    const config = createMigrationConfig(cwd)
    const aiexDir = path.dirname(config.schemaPath)

    if (!args.schema && !args.dir && !args.model) {
      const aiConfig = await loadConfiguredAI(aiexDir)
      if (!aiConfig)
        return

      const ok = await runInteractiveWatch(aiexDir, config, aiConfig)
      if (ok)
        consola.info(t('command.watch.events.pressCtrlC'))
      return
    }

    if (!args.schema) {
      failCommand(t('command.watch.errors.schemaRequired'))
      return
    }

    if (!args.dir) {
      failCommand(t('command.watch.errors.dirRequired'))
      return
    }

    // Verify schema exists
    const schemaLoad = await loadSchema(config, args.schema)
    if (!schemaLoad.schema) {
      failCommand(schemaLoad.error || t('command.watch.errors.schemaNotFound', { name: args.schema }))
      return
    }

    const watchDirAbs = path.resolve(args.dir)
    if (!validateWatchDir(watchDirAbs))
      return

    // Load AI configurations
    const aiConfig = await loadConfiguredAI(aiexDir)
    if (!aiConfig)
      return

    // Resolve model override
    const modelOverride = resolveModelOverride(aiConfig, args.model)
    if (modelOverride === null)
      return

    const watcher = startWatch({
      aiexDir,
      config,
      aiConfig,
      schemaName: args.schema,
      watchDir: watchDirAbs,
      modelOverride,
      insert: !args.noInsert,
    })
    registerCleanup(watcher)

    consola.info(t('command.watch.events.pressCtrlC'))
  },
})

async function runInteractiveWatch(
  aiexDir: string,
  config: MigrationConfig,
  aiConfig: AIConfig,
): Promise<boolean> {
  const schemas = await listSchemas(aiexDir)
  if (schemas.length === 0) {
    failCommand(t('command.extract.errors.noSchemas', { path: pc.cyan('.aiex/schema/'), cmd: pc.cyan('aiex web') }))
    return false
  }

  const schemaName = await select({
    message: t('command.watch.interactive.selectSchema'),
    options: schemas.map(s => ({ label: s, value: s })),
  })

  if (isCancel(schemaName)) {
    cancel(t('common.cancelled'))
    return false
  }

  const dirPath = await text({
    message: t('command.watch.interactive.enterDirPath'),
    validate(value) {
      if (!value || value.trim().length === 0)
        return t('command.watch.interactive.dirPathRequired')
      return undefined
    },
  })

  if (isCancel(dirPath)) {
    cancel(t('common.cancelled'))
    return false
  }

  const selectedModel = await select({
    message: t('command.watch.interactive.selectModel'),
    options: [
      { label: t('command.watch.interactive.autoModel'), value: '' },
      ...aiConfig.provider.models.map(model => ({ label: model.name, value: model.name })),
    ],
  })

  if (isCancel(selectedModel)) {
    cancel(t('common.cancelled'))
    return false
  }

  const noInsert = await confirm({
    message: t('command.watch.interactive.askNoInsert'),
    initialValue: false,
  })

  if (isCancel(noInsert)) {
    cancel(t('common.cancelled'))
    return false
  }

  const watchDir = path.resolve(dirPath as string)
  if (!validateWatchDir(watchDir))
    return false

  const modelOverride = resolveModelOverride(aiConfig, selectedModel ? selectedModel as string : undefined)
  if (modelOverride === null)
    return false

  const watcher = startWatch({
    aiexDir,
    config,
    aiConfig,
    schemaName: schemaName as string,
    watchDir,
    modelOverride,
    insert: !(noInsert as boolean),
  })
  registerCleanup(watcher)

  return true
}

function validateWatchDir(dir: string): boolean {
  let watchDirStat: fs.Stats
  try {
    watchDirStat = fs.statSync(dir)
  }
  catch (e) {
    failCommand(t('command.watch.errors.dirNotExist', { dir, error: e instanceof Error ? e.message : String(e) }))
    return false
  }

  if (!watchDirStat.isDirectory()) {
    failCommand(t('command.watch.errors.notADirectory', { dir }))
    return false
  }

  return true
}

function startWatch(options: {
  aiexDir: string
  config: MigrationConfig
  aiConfig: AIConfig
  schemaName: string
  watchDir: string
  modelOverride?: AIModelConfig
  insert: boolean
}): ReturnType<typeof startWatcher> {
  return startWatcher(options)
}

function registerCleanup(watcher: ReturnType<typeof startWatcher>): void {
  const cleanup = async (): Promise<void> => {
    consola.info(t('command.watch.events.stopped'))
    await watcher.close()
    consola.success(t('command.watch.events.stoppedOk'))
    process.exit(0)
  }

  process.on('SIGINT', cleanup)
  process.on('SIGTERM', cleanup)
}

function cancel(msg: string): void {
  consola.info(msg)
  outro(t('common.cancelled'))
  process.exitCode = 0
}
