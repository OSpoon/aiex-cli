import type { MigrationConfig, MigrationRiskReport, SchemaMappingEntry } from '@/domain/schema/types'
import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'
import { analyzeMigrationRisk } from '@/domain/schema/migration-risk'
import { resolveHelperPath, resolveTsxPath } from '@/infrastructure/runtime/package-paths'
import { t } from '@/locales'
import { parseAllSchemas } from './parse-all-schemas'

const execFileAsync = promisify(execFile)

export interface GenerateSchemaResult {
  success: boolean
  error?: string
  warnings: string[]
  schemaCount: number
  tables: number
  relations: number
  mappingEntries: number
  riskReport: MigrationRiskReport
}

export interface MigrationResult {
  success: boolean
  changes?: number
  tag?: string
  error?: string
}

export interface SchemaSyncResult {
  success: boolean
  error?: string
  warnings: string[]
  schemaCount: number
  tables: number
  relations: number
  mappingEntries: number
  riskReport: MigrationRiskReport
  migration?: MigrationResult
}

interface SchemaMapFile {
  entries?: SchemaMappingEntry[]
  baselineEntries?: SchemaMappingEntry[]
}

const NO_RISK_REPORT: MigrationRiskReport = { level: 'none', items: [], hasHighRisk: false }

function schemaMapPath(config: MigrationConfig): string {
  return path.join(path.dirname(config.drizzleSchemaPath), 'schema-map.json')
}

async function readPreviousSchemaMap(config: MigrationConfig): Promise<SchemaMappingEntry[]> {
  try {
    const content = await fs.readFile(schemaMapPath(config), 'utf-8')
    const parsed = JSON.parse(content) as SchemaMapFile
    if (Array.isArray(parsed.baselineEntries))
      return parsed.baselineEntries
    return Array.isArray(parsed.entries) ? parsed.entries : []
  }
  catch {
    return []
  }
}

export async function listSchemaFiles(schemaDir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(schemaDir)
    return entries
      .filter(f => f.endsWith('.json'))
      .map(f => path.join(schemaDir, f))
      .sort()
  }
  catch {
    return []
  }
}

export async function generateSchemaFromFiles(
  schemaFiles: string[],
  config: MigrationConfig,
  options: { force?: boolean } = {},
): Promise<GenerateSchemaResult> {
  const previousMapping = await readPreviousSchemaMap(config)
  const entries = await Promise.all(
    schemaFiles.map(async (filePath) => {
      const content = await fs.readFile(filePath, 'utf-8')
      return { filePath, content }
    }),
  )

  const result = parseAllSchemas(entries)
  if (!result.success) {
    return {
      success: false,
      error: result.error,
      warnings: [],
      schemaCount: schemaFiles.length,
      tables: 0,
      relations: 0,
      mappingEntries: 0,
      riskReport: NO_RISK_REPORT,
    }
  }

  const { tables, relations, reverseRelations, warnings, mapping, drizzleCode } = result.data
  const riskReport = previousMapping.length > 0
    ? analyzeMigrationRisk(previousMapping, mapping)
    : NO_RISK_REPORT
  await fs.mkdir(path.dirname(config.drizzleSchemaPath), { recursive: true })
  await fs.writeFile(config.drizzleSchemaPath, drizzleCode)
  await fs.writeFile(
    schemaMapPath(config),
    `${JSON.stringify({
      generatedAt: new Date().toISOString(),
      dialect: 'aiex-drizzle-sqlite',
      entries: mapping,
      baselineEntries: riskReport.hasHighRisk && !options.force ? previousMapping : undefined,
      warnings,
      migrationRisk: riskReport,
    }, null, 2)}\n`,
  )

  return {
    success: true,
    warnings,
    schemaCount: schemaFiles.length,
    tables: tables.length,
    relations: relations.length + reverseRelations.length,
    mappingEntries: mapping.length,
    riskReport,
  }
}

export function parseMigrationOutput(stdout: string, stderr: string): MigrationResult {
  try {
    const lines = stdout.trim().split('\n')
    const jsonLine = lines.find(l => l.startsWith('{') && l.endsWith('}'))
    if (!jsonLine)
      return { success: false, error: t('errors.schema.migrationHelperInvalidOutput') }

    const result = JSON.parse(jsonLine) as MigrationResult
    if (!result.success)
      return { success: false, error: result.error || t('errors.schema.migrationFailed') }
    return result
  }
  catch {
    return { success: false, error: stderr || stdout || t('errors.schema.migrationHelperFailed') }
  }
}

export async function runSchemaMigration(
  config: MigrationConfig,
  migrationName?: string,
): Promise<MigrationResult> {
  const helperPath = resolveHelperPath()
  const tsxPath = resolveTsxPath()
  const helperArgs = [tsxPath, helperPath, config.drizzleSchemaPath, config.migrationsPath, config.databasePath]
  if (migrationName)
    helperArgs.push(migrationName)

  try {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      helperArgs,
      { cwd: process.cwd() },
    )

    return parseMigrationOutput(stdout, stderr)
  }
  catch (error: unknown) {
    const execError = error as { stderr?: string, stdout?: string, message?: string }
    return {
      success: false,
      error: execError.stderr || execError.stdout || execError.message || String(error),
    }
  }
}

export async function runSchemaSync(
  config: MigrationConfig,
  options: { migrationName?: string, generateOnly?: boolean, force?: boolean } = {},
): Promise<SchemaSyncResult> {
  const schemaFiles = await listSchemaFiles(config.schemaPath)
  if (schemaFiles.length === 0) {
    return {
      success: false,
      error: t('errors.schema.noFiles'),
      warnings: [],
      schemaCount: 0,
      tables: 0,
      relations: 0,
      mappingEntries: 0,
      riskReport: NO_RISK_REPORT,
    }
  }

  const generated = await generateSchemaFromFiles(schemaFiles, config, { force: options.force })
  if (!generated.success) {
    return {
      success: false,
      error: generated.error,
      warnings: generated.warnings,
      schemaCount: generated.schemaCount,
      tables: generated.tables,
      relations: generated.relations,
      mappingEntries: generated.mappingEntries,
      riskReport: generated.riskReport,
    }
  }

  if (options.generateOnly || (generated.riskReport.hasHighRisk && !options.force)) {
    const blockedByRisk = generated.riskReport.hasHighRisk && !options.force && !options.generateOnly
    return {
      success: !blockedByRisk,
      error: blockedByRisk ? t('errors.schema.highRiskMigrationBlocked') : undefined,
      warnings: generated.warnings,
      schemaCount: generated.schemaCount,
      tables: generated.tables,
      relations: generated.relations,
      mappingEntries: generated.mappingEntries,
      riskReport: generated.riskReport,
    }
  }

  const migration = await runSchemaMigration(config, options.migrationName)
  return {
    success: migration.success,
    error: migration.error,
    warnings: generated.warnings,
    schemaCount: generated.schemaCount,
    tables: generated.tables,
    relations: generated.relations,
    mappingEntries: generated.mappingEntries,
    riskReport: generated.riskReport,
    migration,
  }
}
