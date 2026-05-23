import type { AIConfig, AIModelConfig } from '@/core/ai-extraction/types'
import type { createMigrationConfig } from '@/core/schema-sqlite'
import type { RetryInfo } from '@/utils/retry'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spinner } from '@clack/prompts'
import Database from 'better-sqlite3'
import { consola } from 'consola'
import { readFile as readJsonFile } from 'jsonfile'
import pc from 'picocolors'
import { globSync } from 'tinyglobby'
import { ZodError } from 'zod'
import { extractStructuredData, insertExtractedData } from '@/core/ai-extraction'
import {
  createExtractionAuditRecord,
  findSucceededAuditByHash,
  updateExtractionAuditRecord,
} from '@/core/extraction-audit'
import {
  bytesToMB,
  MAX_UPLOAD_SIZE,
  MAX_UPLOAD_SIZE_TEXT,
} from '@/core/file-constants'
import { recognizeImageText, shouldUseImageOcrFallback } from '@/core/image-ocr'
import { writeNotionPage } from '@/core/notion-sink'
import { createPdfConverter } from '@/core/pdf-converter'
import {
  JsonSchemaDefinitionSchema,
  parseJsonSchema,
} from '@/core/schema-sqlite'
import { sendWebhook } from '@/core/webhook-sink'
import { t } from '@/locales'
import { getFileHash } from '@/utils/hash'

const FILE_PART_EXTENSIONS = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'bmp',
  'svg',
])

const SUPPORTED_EXTENSIONS = new Set([
  ...FILE_PART_EXTENSIONS,
  'pdf',
  'txt',
  'md',
  'csv',
  'json',
  'html',
  'xml',
  'yaml',
  'yml',
])

const PDF_EXT_RE = /\.pdf$/i

const JSON_EXT_RE = /\.json$/
const SUPPORTED_FILE_PATTERN = `*.{${[...SUPPORTED_EXTENSIONS].join(',')}}`

export interface ExtractFileInput {
  text: string
  filePath?: string
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
}

async function syncResultToNotion(
  aiConfig: AIConfig,
  schemaName: string,
  data: unknown,
): Promise<Array<{ databaseId: string, pageId: string }>> {
  if (!data || typeof data !== 'object' || Array.isArray(data))
    throw new Error(t('errors.ai.extractionNotObject'))

  const page = await writeNotionPage(aiConfig.notion, schemaName, data as Record<string, unknown>)
  return [{ databaseId: page.databaseId, pageId: page.pageId }]
}

function shouldSyncNotion(aiConfig: AIConfig, schemaName: string): boolean {
  return !!aiConfig.notion?.enabled && !!aiConfig.notion.schemas?.[schemaName]?.databaseId?.trim()
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

export function listSupportedFiles(dir: string, pattern?: string): string[] {
  if (!fs.statSync(dir).isDirectory())
    throw new Error(t('errors.file.notADirectory', { dir }))

  return globSync(pattern ?? SUPPORTED_FILE_PATTERN, {
    cwd: dir,
    absolute: true,
    onlyFiles: true,
  })
    .filter((file) => {
      const ext = path.extname(file).toLowerCase().replace('.', '')
      return SUPPORTED_EXTENSIONS.has(ext)
    })
    .sort()
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

export function isImageFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase().replace('.', '')
  return FILE_PART_EXTENSIONS.has(ext)
}

export async function readExtractFileInput(filePath: string, aiConfig?: AIConfig, modelOverride?: AIModelConfig): Promise<ExtractFileInput> {
  const stat = fs.statSync(filePath)
  if (stat.size > MAX_UPLOAD_SIZE) {
    throw new Error(t('errors.file.sizeExceeded', { size: bytesToMB(stat.size).toFixed(1), limit: MAX_UPLOAD_SIZE_TEXT, file: filePath }))
  }
  const ext = path.extname(filePath).toLowerCase().replace('.', '')
  if (FILE_PART_EXTENSIONS.has(ext)) {
    if (shouldUseImageOcrFallback(aiConfig, modelOverride)) {
      const result = await recognizeImageText(filePath, aiConfig?.image)
      consola.info(t('extract.file.ocrText', { confidence: (result.confidence * 100).toFixed(1) }))
      return { text: result.text }
    }
    return { text: '', filePath }
  }
  if (ext === 'pdf') {
    const buffer = await fsp.readFile(filePath)
    const converter = createPdfConverter(aiConfig?.pdf)
    const result = await converter.convert(buffer, filePath)
    if (result.metadata?.fallback === 'true') {
      consola.info(t('extract.file.pdfFallback', { count: result.pageCount }))
    }
    else {
      consola.info(t('extract.file.pdfConverted', { name: converter.name, count: result.pageCount }))
    }
    // Save markdown alongside source PDF for reference
    const mdPath = filePath.replace(PDF_EXT_RE, '.md')
    try {
      await fsp.writeFile(mdPath, result.text)
      consola.info(t('extract.file.markdownSaved', { path: mdPath }))
    }
    catch {
      // Fallback: save to temp when source dir is not writable
      const fallbackMd = path.join(os.tmpdir(), `${path.basename(filePath, '.pdf')}.md`)
      await fsp.writeFile(fallbackMd, result.text)
      consola.info(t('extract.file.markdownSaved', { path: fallbackMd }))
    }
    return { text: result.text }
  }
  return { text: await fsp.readFile(filePath, 'utf-8') }
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
    s.start(filePath ? t('extract.file.extractedFrom', { file: path.basename(filePath) }) : t('extract.file.extracting'))
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
        s.message(t('extract.file.extractRetry', { code: info.statusCode, delay: info.delayMs / 1000, attempt: info.attempt, max: info.maxRetries }))
      }
    },
  })

  if (!result.success) {
    if (!options?.quiet) {
      s.stop(t('extract.file.extractFail'))
      consola.error(result.error || t('common.unknownError'))
    }
    return { success: false, error: result.error || t('common.unknownError') }
  }

  if (!options?.quiet) {
    s.stop(t('extract.file.extractComplete'))
  }

  if (result.outputPath && !options?.quiet) {
    consola.success(t('extract.file.resultSaved', { path: pc.cyan(result.outputPath) }))
  }

  if (result.tokensUsed && !options?.quiet) {
    consola.info(
      pc.gray(t('extract.file.tokenUsage', {
        prompt: result.tokensUsed.prompt,
        completion: result.tokensUsed.completion,
        total: result.tokensUsed.total,
      })),
    )
  }

  if (result.data && options?.insert !== false) {
    const s2 = spinner()
    if (!options?.quiet)
      s2.start(t('extract.file.insertingDb'))

    const dbError = await ensureDatabaseReady(config.databasePath, schemaLoad.schema)
    if (dbError) {
      if (!options?.quiet)
        s2.stop(t('extract.file.dbNotReady'))
      consola.error(dbError)
      return { success: false, error: dbError }
    }

    try {
      const db = new Database(config.databasePath)
      try {
        const insertResult = insertExtractedData(db, schemaLoad.schema, result.data as Record<string, unknown>)
        if (insertResult.success) {
          if (!options?.quiet) {
            s2.stop(t('extract.file.insertedTables', { count: insertResult.tablesInserted.length }))
          }
          return {
            success: true,
            outputPath: result.outputPath,
            data: result.data,
            tablesInserted: insertResult.tablesInserted,
            tokensUsed: result.tokensUsed,
          }
        }
        else {
          if (!options?.quiet)
            s2.stop(t('extract.file.dbInsertFail'))
          consola.error(insertResult.error || t('common.unknownError'))
          return { success: false, error: insertResult.error }
        }
      }
      finally {
        db.close()
      }
    }
    catch (e) {
      if (!options?.quiet)
        s2.stop(t('extract.file.dbInsertFail'))
      consola.error(e instanceof Error ? e.message : String(e))
      return { success: false, error: String(e) }
    }
  }

  return {
    success: true,
    outputPath: result.outputPath,
    data: result.data,
    tokensUsed: result.tokensUsed,
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
}

async function triggerWebhook(
  aiConfig: AIConfig,
  auditId: string,
  schemaName: string,
  event: 'extraction.success' | 'extraction.failed',
  source: { type: 'file' | 'text', filePath?: string },
  data?: unknown,
  error?: string,
  tokensUsed?: { prompt: number, completion: number, total: number },
  quiet = false,
): Promise<void> {
  if (!aiConfig.webhook?.enabled)
    return

  try {
    await sendWebhook(aiConfig.webhook, {
      event,
      schemaName,
      auditId,
      timestamp: new Date().toISOString(),
      source: {
        type: source.type,
        fileName: source.filePath ? path.basename(source.filePath) : undefined,
        filePath: source.filePath,
      },
      data,
      error,
      tokensUsed,
    })
    if (!quiet) {
      consola.success(t('extract.file.webhookSynced'))
    }
  }
  catch (err) {
    if (!quiet) {
      consola.error(t('extract.file.webhookSyncFail', { error: err instanceof Error ? err.message : String(err) }))
    }
  }
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
        consola.warn(t('extract.file.hashWarning', {
          file: path.basename(source.filePath),
          error: e instanceof Error ? e.message : String(e),
        }))
      }
    }

    if (fileHash && !isPlainTextFile && !force) {
      const existing = await findSucceededAuditByHash(aiexDir, schemaName, fileHash)
      if (existing) {
        if (!quiet) {
          consola.info(t('extract.file.alreadyProcessed', {
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

  try {
    let text = ''
    let filePath: string | undefined

    if (source.type === 'file') {
      const input = await readExtractFileInput(source.filePath, aiConfig, modelOverride)
      text = input.text
      filePath = input.filePath
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
            consola.success(t('extract.file.notionSynced', { count: notionPages.length }))
          }
        }
        catch (error) {
          await updateExtractionAuditRecord(aiexDir, audit.id, {
            status: 'failed',
            outputPath: r.outputPath,
            outputName: r.outputPath ? path.basename(r.outputPath) : undefined,
            tablesInserted: r.tablesInserted,
            tokensUsed: r.tokensUsed,
            error: error instanceof Error ? error.message : String(error),
          })
          if (!quiet) {
            consola.error(t('extract.file.notionSyncFail', { error: error instanceof Error ? error.message : String(error) }))
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
      }
    }
    else {
      await updateExtractionAuditRecord(aiexDir, audit.id, {
        status: 'failed',
        error: r.error || 'Extraction failed',
      })
      if (!quiet) {
        consola.error(t('extract.file.extractionFailed', { error: r.error }))
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
      }
    }
  }
  catch (e) {
    await updateExtractionAuditRecord(aiexDir, audit.id, {
      status: 'failed',
      error: e instanceof Error ? e.message : String(e),
    })
    if (!quiet) {
      const name = source.type === 'file' ? path.basename(source.filePath) : 'text input'
      consola.error(t('extract.file.errorProcessing', { name, error: e instanceof Error ? e.message : String(e) }))
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
    }
  }
}

export async function processOneFile(
  aiexDir: string,
  config: ReturnType<typeof createMigrationConfig>,
  aiConfig: AIConfig,
  schemaName: string,
  filePath: string,
  modelOverride: AIModelConfig | undefined,
  options?: { insert?: boolean, force?: boolean },
): Promise<boolean> {
  const result = await runAuditedExtraction({
    aiexDir,
    config,
    aiConfig,
    schemaName,
    source: { type: 'file', filePath },
    modelOverride,
    insert: options?.insert,
    force: options?.force,
    quiet: false,
  })

  if (result.success) {
    if (!result.skipped) {
      consola.success(t('extract.file.processSuccess', { file: path.basename(filePath) }))
    }
    return true
  }

  return false
}

export async function runBatchExtraction(
  aiexDir: string,
  config: ReturnType<typeof createMigrationConfig>,
  aiConfig: AIConfig,
  schemaName: string,
  dir: string,
  globPattern: string | undefined,
  modelOverride: AIModelConfig | undefined,
  options?: { insert?: boolean, force?: boolean },
): Promise<BatchExtractionResult> {
  consola.info(t('extract.batch.scanning', { dir: pc.cyan(dir) }))

  let files: string[]
  try {
    files = listSupportedFiles(dir, globPattern)
  }
  catch {
    return { ok: false, successCount: 0, failCount: 0, error: t('extract.batch.errors.cannotReadDir', { dir }) }
  }
  if (files.length === 0) {
    return { ok: false, successCount: 0, failCount: 0, error: t('extract.batch.errors.noSupportedFiles', { dir }) }
  }

  consola.info(t('extract.batch.found', { count: files.length }))

  let successCount = 0
  let failCount = 0

  for (let i = 0; i < files.length; i++) {
    const file = files[i]
    consola.info(`\n${t('extract.batch.processing', { current: i + 1, total: files.length, file: pc.cyan(path.basename(file)) })}`)

    const ok = await processOneFile(aiexDir, config, aiConfig, schemaName, file, modelOverride, { insert: options?.insert, force: options?.force })
    if (ok)
      successCount++
    else
      failCount++
  }

  consola.info(`\n${t('extract.batch.complete', { success: pc.green(successCount), fail: pc.red(failCount), total: files.length })}`)
  return { ok: true, successCount, failCount }
}
