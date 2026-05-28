import type { BatchExtractionResult } from './types'
import type { AIConfig, AIModelConfig } from '@/domain/ai/types'
import type { MigrationConfig } from '@/domain/schema/types'
import fs from 'node:fs'
import path from 'node:path'
import { consola } from 'consola'
import pc from 'picocolors'
import { globSync } from 'tinyglobby'
import { FILE_PART_EXTENSIONS } from '@/application/input/prepare-extraction-input'
import { t } from '@/locales'
import { runAuditedExtraction } from './run-audited-extraction'

export const SUPPORTED_EXTENSIONS = new Set([
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

export const SUPPORTED_FILE_PATTERN = `*.{${[...SUPPORTED_EXTENSIONS].join(',')}}`

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

export async function processOneFile(
  aiexDir: string,
  config: MigrationConfig,
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
      consola.success(t('command.extract.file.processSuccess', { file: path.basename(filePath) }))
    }
    return true
  }

  return false
}

export async function runBatchExtraction(
  aiexDir: string,
  config: MigrationConfig,
  aiConfig: AIConfig,
  schemaName: string,
  dir: string,
  globPattern: string | undefined,
  modelOverride: AIModelConfig | undefined,
  options?: { insert?: boolean, force?: boolean },
): Promise<BatchExtractionResult> {
  consola.info(t('command.extract.batch.scanning', { dir: pc.cyan(dir) }))

  let files: string[]
  try {
    files = listSupportedFiles(dir, globPattern)
  }
  catch {
    return { ok: false, successCount: 0, failCount: 0, error: t('command.extract.batch.errors.cannotReadDir', { dir }) }
  }
  if (files.length === 0) {
    return { ok: false, successCount: 0, failCount: 0, error: t('command.extract.batch.errors.noSupportedFiles', { dir }) }
  }

  consola.info(t('command.extract.batch.found', { count: files.length }))

  let successCount = 0
  let failCount = 0

  for (let i = 0; i < files.length; i++) {
    const file = files[i]
    consola.info(`\n${t('command.extract.batch.processing', { current: i + 1, total: files.length, file: pc.cyan(path.basename(file)) })}`)

    const ok = await processOneFile(aiexDir, config, aiConfig, schemaName, file, modelOverride, { insert: options?.insert, force: options?.force })
    if (ok)
      successCount++
    else
      failCount++
  }

  consola.info(`\n${t('command.extract.batch.complete', { success: pc.green(successCount), fail: pc.red(failCount), total: files.length })}`)

  return {
    ok: true,
    successCount,
    failCount,
  }
}
