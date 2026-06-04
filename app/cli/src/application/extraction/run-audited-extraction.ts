import type { RunAuditedExtractionOptions, RunAuditedExtractionResult } from './types'
import type { ExtractionQualityMetrics } from '@/domain/extraction/quality'
import type { InputProcessingInfo } from '@/domain/input/types'
import path from 'node:path'
import { consola } from 'consola'
import pc from 'picocolors'
import { readExtractFileInput } from '@/application/input/prepare-extraction-input'
import { shouldSyncNotion, syncResultToNotion, triggerWebhook } from '@/application/integrations'
import {
  createExtractionAuditRecord,
  findSucceededAuditByHash,
  updateExtractionAuditRecord,
} from '@/infrastructure/audit/file-audit-store'
import { t } from '@/locales'
import { getFileHash } from '@/utils/hash'
import { classifyInputError, formatInputProcessing, mergeQuality } from './quality'
import { extractSingle } from './run-extraction'

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

  if (source.type === 'file') {
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

    if (fileHash && !force) {
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

    await updateExtractionAuditRecord(aiexDir, audit.id, {
      status: 'failed',
      error: r.error || 'Extraction failed',
      outputPath: r.outputPath,
      outputName: r.outputPath ? path.basename(r.outputPath) : undefined,
      tokensUsed: r.tokensUsed,
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
      r.data,
      r.error || 'Extraction failed',
      r.tokensUsed,
      quiet,
    )
    return {
      success: false,
      error: r.error,
      outputPath: r.outputPath,
      outputName: r.outputPath ? path.basename(r.outputPath) : undefined,
      auditId: audit.id,
      fileHash,
      tokensUsed: r.tokensUsed,
      inputProcessing,
      quality: mergeQuality(inputQuality, r.quality),
      failureStage: r.failureStage ?? 'ai_extraction',
      evidence: r.evidence,
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
