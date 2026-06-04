import type { ExtractResult } from './types'
import type { AIConfig, AIModelConfig } from '@/domain/ai/types'
import type { MigrationConfig } from '@/domain/schema/types'
import type { RetryInfo } from '@/utils/retry'
import path from 'node:path'
import { spinner } from '@clack/prompts'
import { consola } from 'consola'
import pc from 'picocolors'
import { extractStructuredData } from '@/application/ai-extraction/extract-structured-data'
import { loadSchema } from '@/application/schema/load-schema'
import { parseJsonSchema } from '@/domain/schema/parser'
import { createProjectDatabase } from '@/infrastructure/database/sqlite-database'
import { t } from '@/locales'

async function ensureDatabaseReady(config: MigrationConfig, schema: any): Promise<string | null> {
  const database = createProjectDatabase(config)
  if (!(await database.exists()))
    return t('errors.db.notFound', { path: pc.cyan('.aiex/database.db'), cmd: pc.cyan('aiex schema') })

  try {
    const result = parseJsonSchema(schema)
    const tableCheck = await database.verifyTables(result.tables.map(table => table.name))
    if (tableCheck.error)
      return t('errors.db.cannotVerify', { error: tableCheck.error })
    const missing = tableCheck.missing[0]
    if (missing)
      return t('errors.db.tableNotFound', { name: missing, cmd: pc.cyan('aiex schema') })
  }
  catch (e) {
    return t('errors.db.cannotVerify', { error: e instanceof Error ? e.message : String(e) })
  }

  return null
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

    const dbError = await ensureDatabaseReady(config, schemaLoad.schema)
    if (dbError) {
      if (!options?.quiet)
        s2.stop(t('command.extract.file.dbNotReady'))
      consola.error(dbError)
      return { success: false, error: dbError, quality: result.quality, failureStage: 'db_insert' }
    }

    try {
      const database = createProjectDatabase(config)
      const insertResult = database.insertExtracted(schemaLoad.schema, result.data as Record<string, unknown>)
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

      if (!options?.quiet)
        s2.stop(t('command.extract.file.dbInsertFail'))
      consola.error(insertResult.error || t('common.unknownError'))
      return { success: false, error: insertResult.error, quality: result.quality, failureStage: 'db_insert' }
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
