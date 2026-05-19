import type { MigrationConfig } from '@/core/schema-sqlite/types'
import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'
import {
  parseAllSchemas,
  resolveHelperPath,
  resolveTsxPath,
} from '@/core/schema-sqlite'
import tableSchemaFile from '~/schemas/table-schema.json'

const execFileAsync = promisify(execFile)

export interface InitSchemaProjectResult {
  scoreReportStatus: 'created' | 'skipped'
}

export interface GenerateSchemaResult {
  success: boolean
  error?: string
  warnings: string[]
  schemaCount: number
  tables: number
  relations: number
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
  migration?: MigrationResult
}

export const EXAMPLE_SCORE_REPORT_SCHEMA = {
  $schema: (tableSchemaFile as { $id: string }).$id,
  title: 'ScoreReport',
  type: 'object',
  table: { name: 'score_report', timestamps: true },
  properties: {
    name: { type: 'string', description: '姓名' },
    reportNumber: { type: 'string', description: '报告编号' },
    gender: { type: 'string', description: '性别' },
    printDate: { type: 'string', format: 'date-time', description: '打印日期' },
    examYear: { type: 'integer', description: '考试年份' },
    examType: { type: 'string', description: '考试类型，如全国统考' },
    examCategory: { type: 'string', description: '考试类别，如普通高考' },
    province: { type: 'string', description: '考试省份' },
    subjectCategory: { type: 'string', description: '科类，如艺术（文）' },
    chinese: { type: 'integer', description: '语文成绩' },
    chineseFull: { type: 'integer', description: '语文满分' },
    math: { type: 'integer', description: '数学成绩' },
    mathFull: { type: 'integer', description: '数学满分' },
    foreignLang: { type: 'integer', description: '外语成绩' },
    foreignLangFull: { type: 'integer', description: '外语满分' },
    comprehensive: { type: 'integer', description: '综合成绩' },
    comprehensiveFull: { type: 'integer', description: '综合满分' },
    totalScore: { type: 'integer', description: '总分' },
    totalFullScore: { type: 'integer', description: '总分满分' },
    batchLineFirst: { type: 'integer', description: '本科第一批录取分数线' },
    batchLineSecond: { type: 'integer', description: '本科第二批录取分数线' },
  },
  required: ['name', 'examYear', 'examType', 'province', 'totalScore'],
}

async function writeJsonIfAbsent(filePath: string, data: unknown): Promise<'created' | 'skipped'> {
  try {
    await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, { flag: 'wx' })
    return 'created'
  }
  catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST')
      return 'skipped'
    throw error
  }
}

export async function initSchemaProject(config: MigrationConfig): Promise<InitSchemaProjectResult> {
  await fs.mkdir(config.schemaPath, { recursive: true })
  await fs.mkdir(path.dirname(config.drizzleSchemaPath), { recursive: true })
  await fs.mkdir(config.migrationsPath, { recursive: true })

  const scoreReportStatus = await writeJsonIfAbsent(
    path.join(config.schemaPath, 'score_report.json'),
    EXAMPLE_SCORE_REPORT_SCHEMA,
  )

  return { scoreReportStatus }
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
): Promise<GenerateSchemaResult> {
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
    }
  }

  const { tables, relations, reverseRelations, warnings, drizzleCode } = result.data
  await fs.mkdir(path.dirname(config.drizzleSchemaPath), { recursive: true })
  await fs.writeFile(config.drizzleSchemaPath, drizzleCode)

  return {
    success: true,
    warnings,
    schemaCount: schemaFiles.length,
    tables: tables.length,
    relations: relations.length + reverseRelations.length,
  }
}

function parseMigrationOutput(stdout: string, stderr: string): MigrationResult {
  try {
    const lines = stdout.trim().split('\n')
    const jsonLine = lines.find(l => l.startsWith('{') && l.endsWith('}'))
    if (!jsonLine)
      return { success: false, error: 'Migration helper did not return valid output' }

    const result = JSON.parse(jsonLine) as MigrationResult
    if (!result.success)
      return { success: false, error: result.error || 'Migration failed' }
    return result
  }
  catch {
    return { success: false, error: stderr || stdout || 'Migration helper failed' }
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
  options: { migrationName?: string, generateOnly?: boolean } = {},
): Promise<SchemaSyncResult> {
  const schemaFiles = await listSchemaFiles(config.schemaPath)
  if (schemaFiles.length === 0) {
    return {
      success: false,
      error: 'No schema files found',
      warnings: [],
      schemaCount: 0,
      tables: 0,
      relations: 0,
    }
  }

  const generated = await generateSchemaFromFiles(schemaFiles, config)
  if (!generated.success) {
    return {
      success: false,
      error: generated.error,
      warnings: generated.warnings,
      schemaCount: generated.schemaCount,
      tables: generated.tables,
      relations: generated.relations,
    }
  }

  if (options.generateOnly) {
    return {
      success: true,
      warnings: generated.warnings,
      schemaCount: generated.schemaCount,
      tables: generated.tables,
      relations: generated.relations,
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
    migration,
  }
}
