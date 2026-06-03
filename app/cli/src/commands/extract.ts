import type { AIConfig, AIModelConfig } from '@/domain/ai/types'
import type { MigrationConfig } from '@/domain/schema/types'
import path from 'node:path'
import process from 'node:process'
import { confirm, intro, isCancel, outro, select, text } from '@clack/prompts'
import { defineCommand } from 'citty'
import { consola } from 'consola'
import pc from 'picocolors'
import {
  runAuditedExtraction,
  runBatchExtraction,
} from '@/application/extraction'
import { SUPPORTED_FILE_TYPES_TEXT } from '@/application/input/file-policy'
import { listSchemas } from '@/application/schema/load-schema'
import { failCommand } from '@/commands/utils'
import { readAIConfig } from '@/infrastructure/ai/ai-config-store'
import { createMigrationConfig } from '@/infrastructure/schema/migration-config'
import { initI18n, t } from '@/locales'

export async function loadConfiguredAI(aiexDir: string): Promise<AIConfig | null> {
  const aiConfig = await readAIConfig(aiexDir)
  if (!aiConfig) {
    failCommand(t('command.extract.errors.noAIConfig', { cmd: 'aiex web' }))
    return null
  }

  if (!aiConfig.provider.apiKey) {
    failCommand(t('command.extract.errors.noApiKey'))
    return null
  }

  if (!aiConfig.provider.models?.length) {
    failCommand(t('command.extract.errors.noModels'))
    return null
  }

  return aiConfig
}

export function resolveModelOverride(aiConfig: AIConfig, modelName?: string): AIModelConfig | undefined | null {
  if (!modelName)
    return undefined
  const matched = aiConfig.provider.models.find(m => m.name === modelName)
  if (!matched) {
    const available = aiConfig.provider.models.map(m => m.name).join(', ')
    failCommand(t('command.extract.errors.modelNotFound', { model: modelName, available }))
    return null
  }
  return matched
}

export const extractCommand = defineCommand({
  meta: {
    name: 'extract',
    description: t('command.extract.description'),
  },
  args: {
    schema: {
      type: 'string',
      alias: 's',
      description: t('command.extract.args.schema'),
    },
    file: {
      type: 'string',
      alias: 'f',
      description: t('command.extract.args.file', { types: SUPPORTED_FILE_TYPES_TEXT }),
    },
    model: {
      type: 'string',
      alias: 'm',
      description: t('command.extract.args.model'),
    },
    dir: {
      type: 'string',
      alias: 'd',
      description: t('command.extract.args.dir'),
    },
    glob: {
      type: 'string',
      alias: 'g',
      description: t('command.extract.args.glob'),
    },
    noInsert: {
      type: 'boolean',
      description: t('command.extract.args.noInsert'),
      default: false,
    },
    force: {
      type: 'boolean',
      description: t('command.extract.args.force'),
      default: false,
    },
  },
  async run({ args }) {
    intro(pc.inverse(' aiex extract '))
    await initI18n()

    const cwd = process.cwd()
    const config = createMigrationConfig(cwd)
    const aiexDir = path.dirname(config.schemaPath)

    // ── Arg conflict validation ──
    if (args.dir && args.file) {
      failCommand(t('command.extract.errors.conflictFileDir'))
      return
    }

    const aiConfig = await loadConfiguredAI(aiexDir)
    if (!aiConfig)
      return

    // Resolve model override
    const modelOverride = resolveModelOverride(aiConfig, args.model as string | undefined)
    if (modelOverride === null)
      return

    // ── Interactive mode (when no args provided) ──
    if (!args.schema && !args.file && !args.dir) {
      const ok = await runInteractive(aiexDir, config, aiConfig, modelOverride)
      if (ok) {
        outro(t('common.done'))
      }
      return
    }

    // ── Batch mode ──
    if (args.dir) {
      if (!args.schema) {
        failCommand(t('command.extract.errors.schemaRequiredBatch'))
        return
      }
      const result = await runBatchExtraction(aiexDir, config, aiConfig, args.schema as string, args.dir as string, args.glob as string | undefined, modelOverride, { insert: !args.noInsert, force: args.force })
      if (!result.ok) {
        failCommand(result.error)
        return
      }
      if (result.failCount > 0) {
        process.exitCode = 1
      }
      if (result.failCount > 0)
        outro(t('command.extract.batch.failSummary', { count: result.failCount }))
      else
        outro(t('common.done'))
      return
    }

    // ── Single file extraction mode ──
    if (!args.schema) {
      failCommand(t('command.extract.errors.schemaRequiredSingle'))
      return
    }

    if (!args.file) {
      failCommand(t('command.extract.errors.fileRequiredSingle'))
      return
    }

    const result = await runAuditedExtraction({
      aiexDir,
      config,
      aiConfig,
      schemaName: args.schema as string,
      source: { type: 'file', filePath: args.file as string },
      modelOverride,
      insert: !args.noInsert,
      force: args.force,
      quiet: false,
    })

    if (!result.success) {
      failCommand(result.error)
      return
    }

    outro(t('common.done'))
  },
})

async function runInteractive(
  aiexDir: string,
  config: MigrationConfig,
  aiConfig: AIConfig,
  modelOverride: AIModelConfig | undefined,
): Promise<boolean> {
  const schemas = await listSchemas(aiexDir)
  if (schemas.length === 0) {
    failCommand(t('command.extract.errors.noSchemas', { path: pc.cyan('.aiex/schema/'), cmd: pc.cyan('aiex web') }))
    return false
  }

  const schemaName = await select({
    message: t('command.extract.interactive.selectSchema'),
    options: schemas.map(s => ({ label: s, value: s })),
  })

  if (isCancel(schemaName)) {
    cancel(t('common.cancelled'))
    return false
  }

  const inputSource = await select({
    message: t('command.extract.interactive.chooseSource'),
    options: [
      { label: t('command.extract.interactive.singleFile'), value: 'file', hint: t('command.extract.interactive.singleFileHint') },
      { label: t('command.extract.interactive.batchDir'), value: 'dir', hint: t('command.extract.interactive.batchDirHint') },
    ],
  })

  if (isCancel(inputSource)) {
    cancel(t('common.cancelled'))
    return false
  }

  if (inputSource === 'file') {
    const filePathStr = await text({
      message: t('command.extract.interactive.enterFilePath'),
      validate(value) {
        if (!value || value.trim().length === 0)
          return t('command.extract.interactive.filePathRequired')
        return undefined
      },
    })

    if (isCancel(filePathStr)) {
      cancel(t('common.cancelled'))
      return false
    }

    const fp = filePathStr as string

    const force = await confirm({
      message: t('command.extract.interactive.askForce'),
      initialValue: false,
    })

    if (isCancel(force)) {
      cancel(t('common.cancelled'))
      return false
    }

    const result = await runAuditedExtraction({
      aiexDir,
      config,
      aiConfig,
      schemaName: schemaName as string,
      source: { type: 'file', filePath: fp },
      modelOverride,
      force,
    })
    return result.success
  }
  else if (inputSource === 'dir') {
    const dirPath = await text({
      message: t('command.extract.interactive.enterDirPath'),
      validate(value) {
        if (!value || value.trim().length === 0)
          return t('command.extract.interactive.dirPathRequired')
        return undefined
      },
    })

    if (isCancel(dirPath)) {
      cancel(t('common.cancelled'))
      return false
    }

    const force = await confirm({
      message: t('command.extract.interactive.askForce'),
      initialValue: false,
    })

    if (isCancel(force)) {
      cancel(t('common.cancelled'))
      return false
    }

    const result = await runBatchExtraction(
      aiexDir,
      config,
      aiConfig,
      schemaName as string,
      dirPath as string,
      undefined,
      modelOverride,
      { force },
    )
    if (!result.ok)
      failCommand(result.error)
    return result.ok && result.failCount === 0
  }

  return false
}

function cancel(msg: string): void {
  consola.info(msg)
  outro(t('common.cancelled'))
  process.exitCode = 0
}
