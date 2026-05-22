import type { AIConfig, AIModelConfig } from '@/core/ai-extraction/types'
import path from 'node:path'
import process from 'node:process'
import { intro, isCancel, outro, select, text } from '@clack/prompts'
import { defineCommand } from 'citty'
import { consola } from 'consola'
import pc from 'picocolors'
import { failCommand } from '@/commands/utils'
import { readAIConfig } from '@/core/ai-extraction'
import {
  listSchemas,
  runAuditedExtraction,
  runBatchExtraction,
} from '@/core/extract-runner'
import {
  deleteExtractionAuditRecord,
  listExtractionAuditRecords,
  readExtractionAuditRecord,
} from '@/core/extraction-audit'
import { isMissingUploadFileError, MISSING_UPLOAD_FILE_TEXT, SUPPORTED_FILE_TYPES_TEXT } from '@/core/file-constants'
import {
  createMigrationConfig,
} from '@/core/schema-sqlite'

function getIdArg(args: Record<string, unknown>): string {
  if (typeof args.id === 'string')
    return args.id
  const positional = args._ as unknown
  return Array.isArray(positional) && typeof positional[0] === 'string' ? positional[0] : ''
}

function isExtractSubCommand(rawArgs: unknown): boolean {
  if (!Array.isArray(rawArgs))
    return false
  return rawArgs.some(arg => typeof arg === 'string' && ['history', 'show', 'retry', 'rm'].includes(arg))
}

function formatSource(source: { type: 'text' | 'file', fileName?: string }): string {
  return source.type === 'file' ? source.fileName || 'file' : 'unknown'
}

export async function loadConfiguredAI(aiexDir: string): Promise<AIConfig | null> {
  const aiConfig = await readAIConfig(aiexDir)
  if (!aiConfig) {
    failCommand('AI configuration not found. Please run "aiex web" to configure AI settings first')
    return null
  }

  if (!aiConfig.provider.apiKey) {
    failCommand('API Key not configured. Please configure AI settings in the Web interface first')
    return null
  }

  if (!aiConfig.provider.models?.length) {
    failCommand('No models configured. Please add at least one model in AI Settings')
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
    failCommand(`Model "${modelName}" not found in configuration. Available models: ${available}`)
    return null
  }
  return matched
}

const historyCommand = defineCommand({
  meta: {
    name: 'history',
    description: 'List extraction audit records',
  },
  async run() {
    const config = createMigrationConfig(process.cwd())
    const aiexDir = path.dirname(config.schemaPath)
    const records = await listExtractionAuditRecords(aiexDir)

    if (records.length === 0) {
      consola.info('No extraction history found')
      return
    }

    for (const record of records) {
      const suffix = record.error ? ` — ${record.error}` : record.outputName ? ` — ${record.outputName}` : ''
      consola.info(`${record.status.padEnd(9)} ${record.id}  ${record.schemaName}  ${formatSource(record.source)}${suffix}`)
    }
  },
})

const showCommand = defineCommand({
  meta: {
    name: 'show',
    description: 'Show an extraction audit record',
  },
  args: {
    id: {
      type: 'string',
      description: 'Audit record id',
    },
  },
  async run({ args }) {
    const id = getIdArg(args)
    if (!id) {
      failCommand('Audit record id is required')
      return
    }

    const config = createMigrationConfig(process.cwd())
    const aiexDir = path.dirname(config.schemaPath)
    const record = await readExtractionAuditRecord(aiexDir, id)
    if (!record) {
      failCommand(`Extraction record not found: ${id}`)
      return
    }

    consola.info(JSON.stringify(record, null, 2))
  },
})

const retryCommand = defineCommand({
  meta: {
    name: 'retry',
    description: 'Retry an extraction audit record',
  },
  args: {
    id: {
      type: 'string',
      description: 'Audit record id',
    },
    noInsert: {
      type: 'boolean',
      description: 'Extract and save JSON without inserting into SQLite',
      default: false,
    },
  },
  async run({ args }) {
    intro(pc.inverse(' aiex extract retry '))

    const id = getIdArg(args)
    if (!id) {
      failCommand('Audit record id is required')
      return
    }

    const config = createMigrationConfig(process.cwd())
    const aiexDir = path.dirname(config.schemaPath)
    const record = await readExtractionAuditRecord(aiexDir, id)
    if (!record) {
      failCommand(`Extraction record not found: ${id}`)
      return
    }

    const aiConfig = await loadConfiguredAI(aiexDir)
    if (!aiConfig)
      return

    const modelOverride = resolveModelOverride(aiConfig, record.modelName)
    if (modelOverride === null)
      return

    try {
      const result = await runAuditedExtraction({
        aiexDir,
        config,
        aiConfig,
        schemaName: record.schemaName,
        source: record.source as any,
        modelOverride,
        retryOf: record.id,
        insert: !args.noInsert,
        force: true, // Retry should always bypass duplicate check
      })

      if (!result.success) {
        failCommand(result.error)
        return
      }

      outro('Done!')
    }
    catch (error) {
      if (isMissingUploadFileError(error)) {
        failCommand(MISSING_UPLOAD_FILE_TEXT)
        return
      }
      failCommand(error instanceof Error ? error.message : String(error))
    }
  },
})

const rmCommand = defineCommand({
  meta: {
    name: 'rm',
    description: 'Delete an extraction audit record and cached upload',
  },
  args: {
    id: {
      type: 'string',
      description: 'Audit record id',
    },
  },
  async run({ args }) {
    const id = getIdArg(args)
    if (!id) {
      failCommand('Audit record id is required')
      return
    }

    const config = createMigrationConfig(process.cwd())
    const aiexDir = path.dirname(config.schemaPath)
    const deleted = await deleteExtractionAuditRecord(aiexDir, id)
    if (!deleted) {
      failCommand(`Extraction record not found: ${id}`)
      return
    }

    consola.success(`Deleted extraction record: ${id}`)
  },
})

export const extractCommand = defineCommand({
  meta: {
    name: 'extract',
    description: 'Extract structured data from text, images, or PDFs',
  },
  subCommands: {
    history: historyCommand,
    show: showCommand,
    retry: retryCommand,
    rm: rmCommand,
  },
  args: {
    schema: {
      type: 'string',
      alias: 's',
      description: 'Schema name (without .json extension)',
    },
    file: {
      type: 'string',
      alias: 'f',
      description: `File path to extract from. Supported: ${SUPPORTED_FILE_TYPES_TEXT}.`,
    },
    model: {
      type: 'string',
      alias: 'm',
      description: 'AI model to use for extraction (overrides auto-selection)',
    },
    dir: {
      type: 'string',
      alias: 'd',
      description: 'Directory containing files to batch extract',
    },
    glob: {
      type: 'string',
      alias: 'g',
      description: 'Glob pattern to filter files in batch mode (e.g. "*.pdf")',
    },
    noInsert: {
      type: 'boolean',
      description: 'Extract and save JSON without inserting into SQLite',
      default: false,
    },
    force: {
      type: 'boolean',
      description: 'Force re-extraction even if the file has already been processed successfully',
      default: false,
    },
  },
  async run({ args, rawArgs }) {
    if (isExtractSubCommand(rawArgs))
      return

    intro(pc.inverse(' aiex extract '))

    const cwd = process.cwd()
    const config = createMigrationConfig(cwd)
    const aiexDir = path.dirname(config.schemaPath)

    // ── Arg conflict validation ──
    if (args.dir && args.file) {
      failCommand('Cannot combine -f/--file with -d/--dir')
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
        outro('Done!')
      }
      return
    }

    // ── Batch mode ──
    if (args.dir) {
      if (!args.schema) {
        failCommand('Schema name (-s) is required in batch mode')
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
        outro(`Completed with failures (${result.failCount} failed)`)
      else
        outro('Done!')
      return
    }

    // ── Single file extraction mode ──
    if (!args.schema) {
      failCommand('Please provide a schema name (-s) to extract from')
      return
    }

    if (!args.file) {
      failCommand('Please provide a file (-f) to extract from')
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

    outro('Done!')
  },
})

async function runInteractive(
  aiexDir: string,
  config: ReturnType<typeof createMigrationConfig>,
  aiConfig: AIConfig,
  modelOverride: AIModelConfig | undefined,
): Promise<boolean> {
  const schemas = await listSchemas(aiexDir)
  if (schemas.length === 0) {
    failCommand(`No schema files found in ${pc.cyan('.aiex/schema/')}. Run ${pc.cyan('aiex web')} to create and configure schemas first.`)
    return false
  }

  const schemaName = await select({
    message: 'Select a schema to extract data for:',
    options: schemas.map(s => ({ label: s, value: s })),
  })

  if (isCancel(schemaName)) {
    cancel('Cancelled')
    return false
  }

  const inputSource = await select({
    message: 'Choose input source:',
    options: [
      { label: 'Single file', value: 'file', hint: 'Extract from a file (txt, pdf, image)' },
      { label: 'Batch directory', value: 'dir', hint: 'Extract all supported files in a directory' },
    ],
  })

  if (isCancel(inputSource)) {
    cancel('Cancelled')
    return false
  }

  if (inputSource === 'file') {
    const filePathStr = await text({
      message: 'Enter file path:',
      validate(value) {
        if (!value || value.trim().length === 0)
          return 'Please enter a file path'
        return undefined
      },
    })

    if (isCancel(filePathStr)) {
      cancel('Cancelled')
      return false
    }

    const fp = filePathStr as string

    const result = await runAuditedExtraction({
      aiexDir,
      config,
      aiConfig,
      schemaName: schemaName as string,
      source: { type: 'file', filePath: fp },
      modelOverride,
    })
    return result.success
  }
  else if (inputSource === 'dir') {
    const dirPath = await text({
      message: 'Enter directory path:',
      validate(value) {
        if (!value || value.trim().length === 0)
          return 'Please enter a directory path'
        return undefined
      },
    })

    if (isCancel(dirPath)) {
      cancel('Cancelled')
      return false
    }

    const result = await runBatchExtraction(aiexDir, config, aiConfig, schemaName as string, dirPath as string, undefined, modelOverride)
    if (!result.ok)
      failCommand(result.error)
    return result.ok && result.failCount === 0
  }

  return false
}

function cancel(msg: string): void {
  consola.info(msg)
  outro('Cancelled')
  process.exitCode = 0
}
