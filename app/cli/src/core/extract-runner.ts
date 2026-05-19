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
import { createPdfConverter } from '@/core/pdf-converter'
import {
  JsonSchemaDefinitionSchema,
  parseJsonSchema,
} from '@/core/schema-sqlite'

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
    return `Database not found at ${pc.cyan('.aiex/database.db')}. Run ${pc.cyan('aiex schema')} first to create the database.`
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
          return `Table "${table.name}" not found in database. Run ${pc.cyan('aiex schema')} first to create tables.`
        }
      }
    }
    finally {
      db.close()
    }
  }
  catch (e) {
    return `Cannot verify database: ${e instanceof Error ? e.message : String(e)}`
  }

  return null
}

export function listSupportedFiles(dir: string, pattern?: string): string[] {
  if (!fs.statSync(dir).isDirectory())
    throw new Error(`Not a directory: ${dir}`)

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
      return { schema: null, error: `Schema validation failed: ${schemaName}.json\n${e.issues.map(i => `  - ${i.path.join('.')}: ${i.message}`).join('\n')}` }
    }
    const nodeError = e as NodeJS.ErrnoException
    if (nodeError.code === 'ENOENT') {
      return { schema: null, error: `Cannot read schema file: ${schemaName}.json` }
    }
    if (e instanceof SyntaxError) {
      return { schema: null, error: `Invalid JSON in schema file: ${schemaName}.json` }
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

export async function readExtractFileInput(filePath: string, aiConfig?: AIConfig): Promise<ExtractFileInput> {
  const ext = path.extname(filePath).toLowerCase().replace('.', '')
  if (FILE_PART_EXTENSIONS.has(ext)) {
    return { text: '', filePath }
  }
  if (ext === 'pdf') {
    const buffer = await fsp.readFile(filePath)
    const converter = createPdfConverter(aiConfig?.pdf)
    const result = await converter.convert(buffer, filePath)
    consola.info(`Extracted ${result.pageCount} page(s) from PDF`)
    // Save markdown alongside source PDF for reference
    const mdPath = filePath.replace(PDF_EXT_RE, '.md')
    try {
      await fsp.writeFile(mdPath, result.text)
      consola.info(`Markdown saved: ${mdPath}`)
    }
    catch {
      // Fallback: save to temp when source dir is not writable
      const fallbackMd = path.join(os.tmpdir(), `${path.basename(filePath, '.pdf')}.md`)
      await fsp.writeFile(fallbackMd, result.text)
      consola.info(`Markdown saved: ${fallbackMd}`)
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
  options?: { quiet?: boolean },
): Promise<ExtractResult> {
  const schemaLoad = await loadSchema(config, schemaName)
  if (!schemaLoad.schema) {
    if (!options?.quiet)
      consola.error(schemaLoad.error)
    return { success: false, error: schemaLoad.error }
  }

  const s = spinner()
  if (!options?.quiet) {
    s.start(filePath ? `Extracting from ${path.basename(filePath)}...` : 'Extracting data...')
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
        s.message(`API responded with ${info.statusCode}, retrying in ${info.delayMs / 1000}s (${info.attempt}/${info.maxRetries})...`)
      }
    },
  })

  if (!result.success) {
    if (!options?.quiet) {
      s.stop('Extraction failed')
      consola.error(result.error || 'Unknown error')
    }
    return { success: false, error: result.error || 'Unknown error' }
  }

  if (!options?.quiet) {
    s.stop('Extraction complete')
  }

  if (result.outputPath && !options?.quiet) {
    consola.success(`Result saved: ${pc.cyan(result.outputPath)}`)
  }

  if (result.tokensUsed && !options?.quiet) {
    consola.info(
      pc.gray(
        `Token usage: prompt=${result.tokensUsed.prompt}, completion=${result.tokensUsed.completion}, total=${result.tokensUsed.total}`,
      ),
    )
  }

  if (result.data) {
    const s2 = spinner()
    if (!options?.quiet)
      s2.start('Inserting into database...')

    const dbError = await ensureDatabaseReady(config.databasePath, schemaLoad.schema)
    if (dbError) {
      if (!options?.quiet)
        s2.stop('Database not ready')
      consola.error(dbError)
      return { success: false, error: dbError }
    }

    try {
      const db = new Database(config.databasePath)
      try {
        const insertResult = insertExtractedData(db, schemaLoad.schema, result.data as Record<string, unknown>)
        if (insertResult.success) {
          if (!options?.quiet) {
            s2.stop(`Inserted into ${insertResult.tablesInserted.length} table(s)`)
          }
        }
        else {
          if (!options?.quiet)
            s2.stop('Database insert failed')
          consola.error(insertResult.error || 'Unknown error')
          return { success: false, error: insertResult.error }
        }
      }
      finally {
        db.close()
      }
    }
    catch (e) {
      if (!options?.quiet)
        s2.stop('Database insert failed')
      consola.error(e instanceof Error ? e.message : String(e))
      return { success: false, error: String(e) }
    }
  }

  return { success: true }
}

async function processOneFile(
  aiexDir: string,
  config: ReturnType<typeof createMigrationConfig>,
  aiConfig: AIConfig,
  schemaName: string,
  filePath: string,
  modelOverride: AIModelConfig | undefined,
): Promise<boolean> {
  try {
    const input = await readExtractFileInput(filePath, aiConfig)

    const r = await extractSingle(
      aiexDir,
      config,
      aiConfig,
      schemaName,
      input.text,
      input.filePath,
      modelOverride,
      { quiet: false },
    )

    if (r.success) {
      consola.success(`Processed: ${path.basename(filePath)}`)
      return true
    }
    else {
      consola.error(`Failed: ${r.error}`)
      return false
    }
  }
  catch (e) {
    consola.error(`Error processing ${path.basename(filePath)}: ${e instanceof Error ? e.message : String(e)}`)
    return false
  }
}

export async function runBatchExtraction(
  aiexDir: string,
  config: ReturnType<typeof createMigrationConfig>,
  aiConfig: AIConfig,
  schemaName: string,
  dir: string,
  globPattern: string | undefined,
  modelOverride: AIModelConfig | undefined,
): Promise<BatchExtractionResult> {
  consola.info(`Scanning ${pc.cyan(dir)} for supported files...`)

  let files: string[]
  try {
    files = listSupportedFiles(dir, globPattern)
  }
  catch {
    return { ok: false, successCount: 0, failCount: 0, error: `Cannot read directory: ${dir}` }
  }
  if (files.length === 0) {
    return { ok: false, successCount: 0, failCount: 0, error: `No supported files found in ${dir}` }
  }

  consola.info(`Found ${files.length} file(s) to process`)

  let successCount = 0
  let failCount = 0

  for (let i = 0; i < files.length; i++) {
    const file = files[i]
    consola.info(`\n[${i + 1}/${files.length}] Processing: ${pc.cyan(path.basename(file))}`)

    const ok = await processOneFile(aiexDir, config, aiConfig, schemaName, file, modelOverride)
    if (ok)
      successCount++
    else
      failCount++
  }

  consola.info(`\nBatch complete: ${pc.green(`${successCount} succeeded`)}, ${pc.red(`${failCount} failed`)}, ${files.length} total`)
  return { ok: true, successCount, failCount }
}
