import type { DoctorDiagnostics } from '@/domain/doctor/diagnostics'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { execa } from 'execa'
import { readFile as readJsonFile } from 'jsonfile'
import { createConfig } from '@/config'
import { DEFAULT_MINERU_CONFIG } from '@/domain/ai/types'
import { buildDoctorDiagnostics } from '@/domain/doctor/diagnostics'
import { parseJsonSchema } from '@/domain/schema/parser'
import { JsonSchemaDefinitionSchema } from '@/domain/schema/schemas'
import { readAIConfig } from '@/infrastructure/ai/ai-config-store'
import { createProjectDatabase } from '@/infrastructure/database/sqlite-database'
import { checkImageOcrAvailability } from '@/infrastructure/ocr/system-ocr'
import { createMigrationConfig } from '@/infrastructure/schema/migration-config'
import pkg from '~/package.json'

const V1_SUFFIX_RE = /\/v1\/?$/
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url))

export interface CollectDoctorDiagnosticsOptions {
  config?: ReturnType<typeof createConfig>
}

async function checkConnection(baseURL: string): Promise<boolean | null> {
  try {
    const base = baseURL.replace(V1_SUFFIX_RE, '')
    const res = await fetch(`${base}/v1/models`, {
      signal: AbortSignal.timeout(5000),
    })
    return res.ok
  }
  catch {
    return false
  }
}

async function commandAvailable(command: string): Promise<boolean> {
  try {
    await execa('command', ['-v', command], { shell: true })
    return true
  }
  catch {
    return false
  }
}

async function liteparseAvailable(): Promise<boolean> {
  try {
    await import('@llamaindex/liteparse')
    return true
  }
  catch {
    return false
  }
}

async function findImageOcrSelfCheckLogo(): Promise<string | undefined> {
  const candidates = [
    path.resolve(MODULE_DIR, 'logo.png'),
    path.resolve(MODULE_DIR, 'assets/logo.png'),
    path.resolve(MODULE_DIR, '../../assets/logo.png'),
    path.resolve(MODULE_DIR, '../../../web/public/logo.png'),
    path.resolve(MODULE_DIR, '../../web/public/logo.png'),
    path.resolve(MODULE_DIR, '../../dist/web/logo.png'),
    path.resolve(MODULE_DIR, 'web/logo.png'),
  ]

  for (const candidate of candidates) {
    try {
      await fs.access(candidate)
      return candidate
    }
    catch {
      // try next candidate
    }
  }
  return undefined
}

export async function collectDoctorDiagnostics(
  options: CollectDoctorDiagnosticsOptions = {},
): Promise<DoctorDiagnostics> {
  const config = options.config ?? createConfig()
  const cwd = process.cwd()
  const errors: string[] = []
  const imageOcrLogoPath = await findImageOcrSelfCheckLogo()

  const migConfig = createMigrationConfig(cwd)
  const aiexDir = path.dirname(migConfig.schemaPath)
  const dirExists = await fs.stat(aiexDir).then(s => s.isDirectory()).catch(() => false)

  let schemaFiles: string[] = []
  if (dirExists) {
    try {
      const schemaDir = migConfig.schemaPath
      const entries = await fs.readdir(schemaDir).catch(() => [])
      schemaFiles = entries.filter(f => f.endsWith('.json')).sort()
    }
    catch {
      errors.push('Could not read schema directory')
    }
  }

  let aiConfig = false
  let aiApiKeySet = false
  let aiModelCount = 0
  let aiModels: string[] = []
  let aiVisionModelCount = 0
  let aiStructuredOutputModelCount = 0
  let aiProvider: string | null = null
  let aiConnectionOk: boolean | null = null
  let pdfConverter: string | null = null
  let pdfConverterOk: boolean | null = null
  let pdfConverterError: string | undefined

  if (dirExists) {
    const cfg = await readAIConfig(aiexDir)
    if (cfg) {
      aiConfig = true
      aiApiKeySet = Boolean(cfg.provider.apiKey)
      aiModelCount = cfg.provider.models?.length ?? 0
      aiModels = cfg.provider.models?.map(m => m.name) ?? []
      aiVisionModelCount = cfg.provider.models?.filter(m => m.capabilities.vision).length ?? 0
      aiStructuredOutputModelCount = cfg.provider.models?.filter(m => m.capabilities.structuredOutput).length ?? 0
      aiProvider = cfg.provider.baseURL
      aiConnectionOk = await checkConnection(cfg.provider.baseURL)
      pdfConverter = cfg.pdf?.converter ?? 'unpdf'

      if (pdfConverter === 'unpdf') {
        pdfConverterOk = true
      }
      else if (pdfConverter === 'liteparse') {
        pdfConverterOk = await liteparseAvailable()
        if (!pdfConverterOk)
          pdfConverterError = '@llamaindex/liteparse optional dependency is not installed or cannot be loaded'
        else if (cfg.pdf?.liteparse?.ocrEnabled && !cfg.pdf.liteparse.tessdataPath)
          pdfConverterError = 'LiteParse OCR is enabled. If OCR fails, install Tesseract traineddata and configure pdf.liteparse.tessdataPath.'
      }
      else if (pdfConverter === 'mineru') {
        const command = cfg.pdf?.mineru?.command ?? DEFAULT_MINERU_CONFIG.command
        pdfConverterOk = await commandAvailable(command)
        if (!pdfConverterOk)
          pdfConverterError = `Command not found: ${command}`
      }
      else if (pdfConverter === 'external') {
        const command = cfg.pdf?.external?.command
        if (!command) {
          pdfConverterOk = false
          pdfConverterError = 'External converter command is not configured'
        }
        else {
          pdfConverterOk = await commandAvailable(command)
          if (!pdfConverterOk)
            pdfConverterError = `Command not found: ${command}`
        }
      }
      else if (pdfConverter === 'mineru_api') {
        pdfConverterOk = Boolean(cfg.pdf?.mineruApi?.token)
        if (!pdfConverterOk)
          pdfConverterError = 'MinerU API token is not configured'
      }
    }
  }

  let schemaValidCount = 0
  const invalidSchemas: Array<{ file: string, error: string }> = []
  const expectedTables = new Set<string>()
  if (dirExists && schemaFiles.length > 0) {
    for (const file of schemaFiles) {
      try {
        const schemaPath = path.join(migConfig.schemaPath, file)
        const parsed = JsonSchemaDefinitionSchema.parse(await readJsonFile(schemaPath))
        schemaValidCount += 1
        for (const table of parseJsonSchema(parsed).tables) {
          expectedTables.add(table.name)
        }
      }
      catch (error) {
        invalidSchemas.push({
          file,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
  }

  const database = createProjectDatabase(migConfig)
  const dbExists = dirExists ? await database.exists() : false

  let databaseTablesOk: boolean | null = null
  let missingDatabaseTables: string[] = []
  if (dbExists && expectedTables.size > 0) {
    const tableCheck = await database.verifyTables([...expectedTables])
    if (tableCheck.error) {
      databaseTablesOk = false
      errors.push(`Could not inspect database tables: ${tableCheck.error}`)
    }
    else {
      missingDatabaseTables = tableCheck.missing
      databaseTablesOk = tableCheck.ok
    }
  }
  else if (dbExists) {
    databaseTablesOk = true
  }

  let migrationCount = 0
  if (dirExists) {
    try {
      const entries = await fs.readdir(migConfig.migrationsPath).catch(() => [])
      migrationCount = entries.filter(f => f.endsWith('.sql')).length
    }
    catch {
      // no migrations dir
    }
  }

  return buildDoctorDiagnostics({
    pkg: { name: pkg.name, version: pkg.version },
    executable: process.argv[1] ?? 'unknown',
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    shell: process.env.SHELL ?? process.env.ComSpec ?? 'unknown',
    packageManager: process.env.npm_config_user_agent?.split(' ')[0] || 'unknown',
    osType: os.type(),
    osRelease: os.release(),
    cwd,
    imageOcr: await checkImageOcrAvailability(imageOcrLogoPath),
    configPath: config.path,
    configStoreKeys: Object.keys(config.store),
    project: {
      aiexDir,
      dirExists,
      schemaCount: schemaFiles.length,
      schemaFiles,
      aiConfig,
      aiApiKeySet,
      aiModelCount,
      aiModels,
      aiVisionModelCount,
      aiStructuredOutputModelCount,
      aiProvider,
      aiConnectionOk,
      pdfConverter,
      pdfConverterOk,
      pdfConverterError,
      hasDatabase: dbExists,
      databaseTablesOk,
      missingDatabaseTables,
      migrationCount,
      schemaValidCount,
      invalidSchemas,
      errors,
    },
  })
}
