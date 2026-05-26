import type { AIConfig, AIModelConfig, ExtractResult, MigrationConfig, RunAuditedExtractionOptions, RunAuditedExtractionResult } from '@/types'
import type { RetryInfo } from '@/utils/retry'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { spinner } from '@clack/prompts'
import Database from 'better-sqlite3'
import { consola } from 'consola'
import { getEncoding } from 'js-tiktoken'
import { readFile as readJsonFile } from 'jsonfile'
import pc from 'picocolors'
import { ZodError } from 'zod'
import { calculateChunkTokenBudget, extractStructuredData, insertExtractedData, mergeExtractionResults, splitMarkdown, validateExtractedData } from '@/core/ai-extraction'
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
import { applySelectedCandidates, buildCandidateMergeReport, writeExtractionEvidence } from './ai-extraction/evidence'
import { shouldSyncNotion, syncResultToNotion, triggerWebhook } from './integration/dispatcher'
import { readExtractFileInput } from './pdf-converter/orchestrator'

const encoding = getEncoding('cl100k_base')

// Re-exports for backwards compatibility and external usage
export { listSupportedFiles, processOneFile, runBatchExtraction } from './batch/batch-processor'
export { shouldSyncNotion, syncResultToNotion, triggerWebhook } from './integration/dispatcher'
export { isImageFile, readExtractFileInput } from './pdf-converter/orchestrator'

const JSON_EXT_RE = /\.json$/

async function limitConcurrency<T, R>(
  concurrency: number,
  items: T[],
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = Array.from({ length: items.length })
  let nextIndex = 0

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex++
      results[currentIndex] = await fn(items[currentIndex], currentIndex)
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    worker,
  )
  await Promise.all(workers)
  return results
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

export async function loadSchema(config: MigrationConfig, schemaName: string): Promise<{ schema: any, error?: string }> {
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
  config: MigrationConfig,
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

  const configuredMaxTokens = aiConfig.extraction?.maxTokens ?? 8000
  const maxTokens = calculateChunkTokenBudget({
    configuredMaxTokens,
    modelMaxTokens: modelOverride?.capabilities.maxTokens,
  })
  const overlapTokens = aiConfig.extraction?.overlapSize ?? 1000
  const totalTokens = text ? encoding.encode(text).length : 0

  if (text && totalTokens > maxTokens && !options?.quiet) {
    consola.info(t('command.extract.file.chunking', { length: totalTokens, limit: maxTokens }))
  }

  const processedDocs = text && totalTokens > maxTokens
    ? splitMarkdown(text, maxTokens, overlapTokens)
    : [{
        pageContent: text ?? '',
        metadata: {},
        chunkIndex: 0,
        totalChunks: 1,
        tokenCount: totalTokens,
        headingPath: [],
        charStart: 0,
        charEnd: text?.length ?? 0,
      }]

  if (text && totalTokens > maxTokens && !options?.quiet) {
    consola.info(t('command.extract.file.chunksCount', { count: processedDocs.length }))
  }

  const chunkResults: Array<Record<string, any> | undefined> = Array.from({ length: processedDocs.length })
  const accumulatedTokens = { prompt: 0, completion: 0, total: 0 }
  let success = true
  let errorMsg = ''

  const extractionTasks = processedDocs.map((doc, i) => {
    return async () => {
      if (!success)
        return

      const headings = doc.headingPath?.length
        ? doc.headingPath
        : [doc.metadata.h1, doc.metadata.h2, doc.metadata.h3, doc.metadata.h4].filter(Boolean) as string[]

      let chunkText = doc.pageContent
      if (headings.length > 0) {
        chunkText = `> **[Context]** Belong to: ${headings.join(' > ')}\n\n${chunkText}`
      }

      const chunkResult = await extractStructuredData({
        config: aiConfig,
        schema: schemaLoad.schema,
        text: chunkText,
        aiexDir,
        modelOverride,
        onRetry(info: RetryInfo) {
          if (!options?.quiet) {
            s.message(t('command.extract.file.extractRetryChunk', {
              current: i + 1,
              total: processedDocs.length,
              code: info.statusCode,
              delay: info.delayMs / 1000,
              attempt: info.attempt,
              max: info.maxRetries,
            }))
          }
        },
      })

      if (!chunkResult.success) {
        success = false
        errorMsg = chunkResult.error || t('common.unknownError')
        if (!options?.quiet) {
          s.stop(t('command.extract.file.extractFailChunk', { current: i + 1 }))
          consola.error(errorMsg)
        }
        return
      }

      if (chunkResult.data) {
        chunkResults[i] = chunkResult.data as Record<string, any>
      }
      if (chunkResult.tokensUsed) {
        accumulatedTokens.prompt += chunkResult.tokensUsed.prompt ?? 0
        accumulatedTokens.completion += chunkResult.tokensUsed.completion ?? 0
        accumulatedTokens.total += chunkResult.tokensUsed.total ?? 0
      }
    }
  })

  const concurrency = Math.min(aiConfig.extraction?.concurrency ?? 2, 2)

  if (!options?.quiet && processedDocs.length > 0) {
    s.message(t('command.extract.file.extractingChunk', { current: 1, total: processedDocs.length }))
  }

  try {
    await limitConcurrency(concurrency, extractionTasks, async (task, idx) => {
      if (!options?.quiet && success) {
        s.message(t('command.extract.file.extractingChunk', { current: idx + 1, total: processedDocs.length }))
      }
      await task()
    })
  }
  catch (e) {
    success = false
    errorMsg = e instanceof Error ? e.message : String(e)
  }

  if (!success) {
    return { success: false, error: errorMsg }
  }

  const successfulChunkResults = chunkResults.filter((chunkResult): chunkResult is Record<string, any> => !!chunkResult)
  const candidateReport = buildCandidateMergeReport({
    schema: schemaLoad.schema,
    chunkResults: successfulChunkResults,
    chunks: processedDocs,
  })
  const mergedData = applySelectedCandidates(
    mergeExtractionResults(schemaLoad.schema, successfulChunkResults),
    candidateReport,
  )
  const validation = validateExtractedData(schemaLoad.schema, mergedData)
  if (!validation.success) {
    const valError = (validation as any).error || 'Merged data validation failed'
    if (!options?.quiet) {
      s.stop(t('command.extract.file.validationFail'))
      consola.error(valError)
    }
    return { success: false, error: valError }
  }

  const outputDir = path.resolve(aiexDir, aiConfig.extraction?.outputDir?.replace('.aiex/', '') ?? 'extracted')
  await fsp.mkdir(outputDir, { recursive: true })
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const outputFileName = `${schemaLoad.schema.table.name}-${timestamp}.json`
  const outputPath = path.join(outputDir, outputFileName)
  await fsp.writeFile(outputPath, JSON.stringify(mergedData, null, 2))
  const evidenceSummary = await writeExtractionEvidence({
    schema: schemaLoad.schema,
    data: mergedData,
    outputPath,
    chunks: processedDocs,
    candidateReport,
  })

  const result = {
    success: true,
    data: mergedData,
    tokensUsed: accumulatedTokens,
    outputPath,
    evidenceSummary,
  }

  if (!options?.quiet) {
    s.stop(t('command.extract.file.extractComplete'))
  }

  if (result.outputPath && !options?.quiet) {
    consola.success(t('command.extract.file.resultSaved', { path: pc.cyan(result.outputPath) }))
  }

  if (result.evidenceSummary && !options?.quiet) {
    const summary = result.evidenceSummary
    const issueText = summary.issueCount > 0 ? pc.yellow(String(summary.issueCount)) : pc.green('0')
    consola.info(pc.gray(`Evidence coverage: ${summary.evidenceCount}/${summary.fieldCount} fields, found ${summary.foundCount}, inferred ${summary.inferredCount}, missing ${summary.missingCount}, conflicts ${summary.conflictCount ?? 0}, issues ${issueText}`))
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
      return { success: false, error: dbError }
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
            evidenceSummary: result.evidenceSummary,
            tokensUsed: result.tokensUsed,
          }
        }
        else {
          if (!options?.quiet)
            s2.stop(t('command.extract.file.dbInsertFail'))
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
        s2.stop(t('command.extract.file.dbInsertFail'))
      consola.error(e instanceof Error ? e.message : String(e))
      return { success: false, error: String(e) }
    }
  }

  return {
    success: true,
    outputPath: result.outputPath,
    data: result.data,
    evidenceSummary: result.evidenceSummary,
    tokensUsed: result.tokensUsed,
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

    if (source.type === 'file') {
      const input = await readExtractFileInput(source.filePath, aiConfig)
      text = input.text
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
      source.type === 'file' ? source.filePath : undefined,
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
        evidenceSummary: r.evidenceSummary,
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
    }
  }
}
