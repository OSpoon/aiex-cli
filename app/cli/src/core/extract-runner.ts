import type { InputProcessingInfo } from './pdf-converter/orchestrator'
import type { AIConfig, AIModelConfig } from '@/core/ai-extraction/types'
import type { ExtractionFailureStage, ExtractionQualityMetrics, FieldEvidence } from '@/core/extraction-audit'
import type { createMigrationConfig } from '@/core/schema-sqlite'
import type { RetryInfo } from '@/utils/retry'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { spinner } from '@clack/prompts'
import Database from 'better-sqlite3'
import { consola } from 'consola'
import { readFile as readJsonFile } from 'jsonfile'
import pc from 'picocolors'
import { ZodError } from 'zod'
import { extractStructuredData, insertExtractedData } from '@/core/ai-extraction'
import {
  createExtractionAuditRecord,
  findSucceededAuditByHash,
  updateExtractionAuditRecord,
} from '@/core/extraction-audit'
import {
  JsonSchemaDefinitionSchema,
  parseJsonSchema,
} from '@/core/schema-sqlite'
import { t } from '@/locales'
import { getFileHash } from '@/utils/hash'
import { shouldSyncNotion, syncResultToNotion, triggerWebhook } from './integration/dispatcher'
import { readExtractFileInput } from './pdf-converter/orchestrator'

// Re-exports for backwards compatibility and external usage
export { listSupportedFiles, processOneFile, runBatchExtraction } from './batch/batch-processor'
export { shouldSyncNotion, syncResultToNotion, triggerWebhook } from './integration/dispatcher'
export { describeExtractFileInput, isImageFile, readExtractFileInput } from './pdf-converter/orchestrator'

const JSON_EXT_RE = /\.json$/

export interface ExtractFileInput {
  text: string
  filePath?: string
  inputProcessing?: InputProcessingInfo
  quality?: ExtractionQualityMetrics
}

export interface ExtractResult {
  success: boolean
  error?: string
  outputPath?: string
  data?: unknown
  tablesInserted?: Array<{ table: string, rowId: number }>
  notionPages?: Array<{ databaseId: string, pageId: string }>
  tokensUsed?: {
    prompt: number
    completion: number
    total: number
  }
  quality?: ExtractionQualityMetrics
  failureStage?: ExtractionFailureStage
  evidence?: Record<string, FieldEvidence>
}

export interface BatchExtractionResult {
  ok: boolean
  successCount: number
  failCount: number
  error?: string
}

async function ensureDatabaseReady(dbPath: string, schema: any): Promise<string | null> {
  try {
    await fsp.access(dbPath)
  }
  catch {
    return t('errors.db.notFound', { path: pc.cyan('.aiex/database.db'), cmd: pc.cyan('aiex schema') })
  }

  try {
    const result = parseJsonSchema(schema)
    const db = new Database(dbPath)
    try {
      for (const table of result.tables) {
        const row = db.prepare(
          `SELECT name FROM sqlite_master WHERE type='table' AND name=?`,
        ).get(table.name)
        if (!row) {
          return t('errors.db.tableNotFound', { name: table.name, cmd: pc.cyan('aiex schema') })
        }
      }
    }
    finally {
      db.close()
    }
  }
  catch (e) {
    return t('errors.db.cannotVerify', { error: e instanceof Error ? e.message : String(e) })
  }

  return null
}

export async function loadSchema(config: ReturnType<typeof createMigrationConfig>, schemaName: string): Promise<{ schema: any, error?: string }> {
  const schemaPath = path.join(config.schemaPath, `${schemaName}.json`)
  try {
    const parsed = await readJsonFile(schemaPath)
    const validated = JsonSchemaDefinitionSchema.parse(parsed)
    return { schema: validated }
  }
  catch (e) {
    if (e instanceof ZodError) {
      return { schema: null, error: t('errors.schema.validationFailed', { name: `${schemaName}.json`, issues: e.issues.map(i => `  - ${i.path.join('.')}: ${i.message}`).join('\n') }) }
    }
    const nodeError = e as NodeJS.ErrnoException
    if (nodeError.code === 'ENOENT') {
      return { schema: null, error: t('errors.schema.cannotRead', { name: `${schemaName}.json` }) }
    }
    if (e instanceof SyntaxError) {
      return { schema: null, error: t('errors.schema.invalidJson', { name: `${schemaName}.json` }) }
    }
    return { schema: null, error: String(e) }
  }
}

export async function listSchemas(aiexDir: string): Promise<string[]> {
  try {
    const dir = path.join(aiexDir, 'schema')
    const entries = await fsp.readdir(dir)
    return entries
      .filter(f => f.endsWith('.json'))
      .map(f => f.replace(JSON_EXT_RE, ''))
      .sort()
  }
  catch {
    return []
  }
}

export async function extractSingle(
  aiexDir: string,
  config: ReturnType<typeof createMigrationConfig>,
  aiConfig: AIConfig,
  schemaName: string,
  text: string | undefined,
  filePath?: string,
  modelOverride?: AIModelConfig,
  options?: { quiet?: boolean, insert?: boolean },
): Promise<ExtractResult> {
  const schemaLoad = await loadSchema(config, schemaName)
  if (!schemaLoad.schema) {
    if (!options?.quiet)
      consola.error(schemaLoad.error)
    return { success: false, error: schemaLoad.error }
  }

  const s = spinner()
  if (!options?.quiet) {
    s.start(filePath ? t('command.extract.file.extractedFrom', { file: path.basename(filePath) }) : t('command.extract.file.extracting'))
  }

  const result = await extractStructuredData({
    config: aiConfig,
    schema: schemaLoad.schema,
    text: text ?? '',
    aiexDir,
    file: filePath,
    modelOverride,
    onRetry(info: RetryInfo) {
      if (!options?.quiet) {
        s.message(t('command.extract.file.extractRetry', { code: info.statusCode, delay: info.delayMs / 1000, attempt: info.attempt, max: info.maxRetries }))
      }
    },
  })

  if (!result.success) {
    if (!options?.quiet) {
      s.stop(t('command.extract.file.extractFail'))
      consola.error(result.error || t('common.unknownError'))
    }
    return { success: false, error: result.error || t('common.unknownError'), quality: result.quality, failureStage: 'ai_extraction' }
  }

  if (!options?.quiet) {
    s.stop(t('command.extract.file.extractComplete'))
  }

  if (result.outputPath && !options?.quiet) {
    consola.success(t('command.extract.file.resultSaved', { path: pc.cyan(result.outputPath) }))
  }

  if (result.tokensUsed && !options?.quiet) {
    consola.info(
      pc.gray(t('command.extract.file.tokenUsage', {
        prompt: result.tokensUsed.prompt,
        completion: result.tokensUsed.completion,
        total: result.tokensUsed.total,
      })),
    )
  }

  if (result.data && options?.insert !== false) {
    const s2 = spinner()
    if (!options?.quiet)
      s2.start(t('command.extract.file.insertingDb'))

    const dbError = await ensureDatabaseReady(config.databasePath, schemaLoad.schema)
    if (dbError) {
      if (!options?.quiet)
        s2.stop(t('command.extract.file.dbNotReady'))
      consola.error(dbError)
      return { success: false, error: dbError, quality: result.quality, failureStage: 'db_insert' }
    }

    try {
      const db = new Database(config.databasePath)
      try {
        const insertResult = insertExtractedData(db, schemaLoad.schema, result.data as Record<string, unknown>)
        if (insertResult.success) {
          if (!options?.quiet) {
            s2.stop(t('command.extract.file.insertedTables', { count: insertResult.tablesInserted.length }))
          }
          return {
            success: true,
            outputPath: result.outputPath,
            data: result.data,
            tablesInserted: insertResult.tablesInserted,
            tokensUsed: result.tokensUsed,
            quality: result.quality,
            evidence: result.evidence,
          }
        }
        else {
          if (!options?.quiet)
            s2.stop(t('command.extract.file.dbInsertFail'))
          consola.error(insertResult.error || t('common.unknownError'))
          return { success: false, error: insertResult.error, quality: result.quality, failureStage: 'db_insert' }
        }
      }
      finally {
        db.close()
      }
    }
    catch (e) {
      if (!options?.quiet)
        s2.stop(t('command.extract.file.dbInsertFail'))
      consola.error(e instanceof Error ? e.message : String(e))
      return { success: false, error: String(e), quality: result.quality, failureStage: 'db_insert' }
    }
  }

  return {
    success: true,
    outputPath: result.outputPath,
    data: result.data,
    tokensUsed: result.tokensUsed,
    quality: result.quality,
    evidence: result.evidence,
  }
}

export interface RunAuditedExtractionOptions {
  aiexDir: string
  config: ReturnType<typeof createMigrationConfig>
  aiConfig: AIConfig
  schemaName: string
  source:
    | { type: 'file', filePath: string }
    | { type: 'text', text: string }
  modelOverride?: AIModelConfig
  retryOf?: string
  insert?: boolean
  force?: boolean
  quiet?: boolean
}

export interface RunAuditedExtractionResult {
  success: boolean
  skipped?: boolean
  error?: string
  outputPath?: string
  outputName?: string
  tablesInserted?: Array<{ table: string, rowId: number }>
  notionPages?: Array<{ databaseId: string, pageId: string }>
  tokensUsed?: {
    prompt: number
    completion: number
    total: number
  }
  auditId?: string
  fileHash?: string
  inputProcessing?: InputProcessingInfo
  quality?: ExtractionQualityMetrics
  failureStage?: ExtractionFailureStage
  evidence?: Record<string, FieldEvidence>
}

function formatInputProcessing(input: InputProcessingInfo): string {
  const handler = input.converter ? `${input.handler}(${input.converter})` : input.handler
  return `${input.mime ?? input.kind} -> ${handler}`
}

function mergeQuality(
  inputQuality: ExtractionQualityMetrics | undefined,
  aiQuality: ExtractionQualityMetrics | undefined,
): ExtractionQualityMetrics | undefined {
  if (!inputQuality && !aiQuality)
    return undefined
  return {
    input: inputQuality?.input,
    ai: aiQuality?.ai,
  }
}

function classifyInputError(error: unknown, inputProcessing?: InputProcessingInfo): ExtractionFailureStage {
  if (inputProcessing?.handler === 'pdf_converter')
    return 'file_conversion'
  if (inputProcessing?.handler === 'image_local_ocr')
    return 'ocr'

  const message = (error instanceof Error ? error.message : String(error)).toLowerCase()
  if (message.includes('ocr'))
    return 'ocr'
  if (message.includes('pdf') || message.includes('converter'))
    return 'file_conversion'
  return 'input_detection'
}

export async function runAuditedExtraction(
  options: RunAuditedExtractionOptions,
): Promise<RunAuditedExtractionResult> {
  const {
    aiexDir,
    config,
    aiConfig,
    schemaName,
    source,
    modelOverride,
    retryOf,
    insert,
    force,
    quiet = false,
  } = options

  let fileHash: string | undefined
  let isPlainTextFile = false

  if (source.type === 'file') {
    const ext = path.extname(source.filePath).toLowerCase().replace('.', '')
    isPlainTextFile = ['txt', 'md', 'csv', 'json', 'html', 'xml', 'yaml', 'yml'].includes(ext)

    try {
      fileHash = await getFileHash(source.filePath)
    }
    catch (e) {
      if (!quiet) {
        consola.warn(t('command.extract.file.hashWarning', {
          file: path.basename(source.filePath),
          error: e instanceof Error ? e.message : String(e),
        }))
      }
    }

    if (fileHash && !isPlainTextFile && !force) {
      const existing = await findSucceededAuditByHash(aiexDir, schemaName, fileHash)
      if (existing) {
        if (!quiet) {
          consola.info(t('command.extract.file.alreadyProcessed', {
            file: pc.cyan(path.basename(source.filePath)),
            hash: fileHash.slice(0, 8),
          }))
        }
        return {
          success: true,
          skipped: true,
          auditId: existing.id,
          fileHash,
          outputPath: existing.outputPath,
          outputName: existing.outputName,
          tablesInserted: existing.tablesInserted,
          notionPages: existing.notionPages,
          tokensUsed: existing.tokensUsed,
          inputProcessing: existing.inputProcessing,
          quality: existing.quality,
          failureStage: existing.failureStage,
          evidence: existing.evidence,
        }
      }
    }
  }

  const audit = await createExtractionAuditRecord(aiexDir, {
    schemaName,
    modelName: modelOverride?.name,
    source: source.type === 'file'
      ? { type: 'file', filePath: source.filePath, fileName: path.basename(source.filePath), fileHash }
      : { type: 'text', text: source.text },
    retryOf,
  })

  let inputProcessing: InputProcessingInfo | undefined
  let inputQuality: ExtractionQualityMetrics | undefined

  try {
    let text = ''
    let filePath: string | undefined

    if (source.type === 'file') {
      const input = await readExtractFileInput(source.filePath, aiConfig, modelOverride)
      text = input.text
      filePath = input.filePath
      inputProcessing = input.inputProcessing
      inputQuality = input.quality
      if (!quiet)
        consola.info(`Input: ${formatInputProcessing(inputProcessing)}`)
      await updateExtractionAuditRecord(aiexDir, audit.id, {
        inputProcessing,
        quality: inputQuality,
      })
    }
    else {
      text = source.text
    }

    const r = await extractSingle(
      aiexDir,
      config,
      aiConfig,
      schemaName,
      text,
      filePath,
      modelOverride,
      { quiet, insert },
    )

    if (r.success) {
      let notionPages: Array<{ databaseId: string, pageId: string }> | undefined
      if (shouldSyncNotion(aiConfig, schemaName)) {
        try {
          notionPages = await syncResultToNotion(aiConfig, schemaName, r.data)
          if (!quiet) {
            consola.success(t('command.extract.file.notionSynced', { count: notionPages.length }))
          }
        }
        catch (error) {
          await updateExtractionAuditRecord(aiexDir, audit.id, {
            status: 'failed',
            outputPath: r.outputPath,
            outputName: r.outputPath ? path.basename(r.outputPath) : undefined,
            tablesInserted: r.tablesInserted,
            tokensUsed: r.tokensUsed,
            quality: mergeQuality(inputQuality, r.quality),
            failureStage: 'integration',
            evidence: r.evidence,
            error: error instanceof Error ? error.message : String(error),
          })
          if (!quiet) {
            consola.error(t('command.extract.file.notionSyncFail', { error: error instanceof Error ? error.message : String(error) }))
          }
          await triggerWebhook(
            aiConfig,
            audit.id,
            schemaName,
            'extraction.failed',
            source,
            r.data,
            error instanceof Error ? error.message : String(error),
            r.tokensUsed,
            quiet,
          )
          return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
            auditId: audit.id,
            fileHash,
            inputProcessing,
            quality: mergeQuality(inputQuality, r.quality),
            failureStage: 'integration',
            evidence: r.evidence,
          }
        }
      }

      const updated = await updateExtractionAuditRecord(aiexDir, audit.id, {
        status: 'succeeded',
        outputPath: r.outputPath,
        outputName: r.outputPath ? path.basename(r.outputPath) : undefined,
        tablesInserted: r.tablesInserted,
        notionPages,
        tokensUsed: r.tokensUsed,
        quality: mergeQuality(inputQuality, r.quality),
        evidence: r.evidence,
      })

      await triggerWebhook(
        aiConfig,
        audit.id,
        schemaName,
        'extraction.success',
        source,
        r.data,
        undefined,
        r.tokensUsed,
        quiet,
      )

      return {
        success: true,
        outputPath: updated.outputPath,
        outputName: updated.outputName,
        tablesInserted: updated.tablesInserted,
        notionPages: updated.notionPages,
        tokensUsed: updated.tokensUsed,
        auditId: updated.id,
        fileHash,
        inputProcessing: updated.inputProcessing,
        quality: updated.quality,
        failureStage: updated.failureStage,
        evidence: updated.evidence,
      }
    }
    else {
      await updateExtractionAuditRecord(aiexDir, audit.id, {
        status: 'failed',
        error: r.error || 'Extraction failed',
        quality: mergeQuality(inputQuality, r.quality),
        failureStage: r.failureStage ?? 'ai_extraction',
        evidence: r.evidence,
      })
      if (!quiet) {
        consola.error(t('command.extract.file.extractionFailed', { error: r.error }))
      }
      await triggerWebhook(
        aiConfig,
        audit.id,
        schemaName,
        'extraction.failed',
        source,
        undefined,
        r.error || 'Extraction failed',
        undefined,
        quiet,
      )
      return {
        success: false,
        error: r.error,
        auditId: audit.id,
        fileHash,
        inputProcessing,
        quality: mergeQuality(inputQuality, r.quality),
        failureStage: r.failureStage ?? 'ai_extraction',
        evidence: r.evidence,
      }
    }
  }
  catch (e) {
    const failureStage = classifyInputError(e, inputProcessing)
    await updateExtractionAuditRecord(aiexDir, audit.id, {
      status: 'failed',
      error: e instanceof Error ? e.message : String(e),
      quality: inputQuality,
      failureStage,
    })
    if (!quiet) {
      const name = source.type === 'file' ? path.basename(source.filePath) : 'text input'
      consola.error(t('command.extract.file.errorProcessing', { name, error: e instanceof Error ? e.message : String(e) }))
    }
    await triggerWebhook(
      aiConfig,
      audit.id,
      schemaName,
      'extraction.failed',
      source,
      undefined,
      e instanceof Error ? e.message : String(e),
      undefined,
      quiet,
    )
    return {
      success: false,
      error: e instanceof Error ? e.message : String(e),
      auditId: audit.id,
      fileHash,
      inputProcessing,
      quality: inputQuality,
      failureStage,
    }
  }
}
