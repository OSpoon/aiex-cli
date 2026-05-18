import type { MigrationConfig } from '@/core/schema-sqlite/types'
import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'
import { intro, outro, spinner } from '@clack/prompts'
import { defineCommand } from 'citty'
import { consola } from 'consola'
import pc from 'picocolors'
import {
  createMigrationConfig,
  parseAllSchemas,
  resolveHelperPath,
  resolveTsxPath,
} from '@/core/schema-sqlite'
import tableSchemaFile from '~/schemas/table-schema.json'

const execFileAsync = promisify(execFile)

function fail(message?: string): void {
  if (message)
    consola.error(message)
  outro('Failed!')
  process.exitCode = 1
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

async function generateFromFiles(schemaFiles: string[], config: MigrationConfig): Promise<boolean> {
  const entries = await Promise.all(
    schemaFiles.map(async (filePath) => {
      const content = await fs.readFile(filePath, 'utf-8')
      return { filePath, content }
    }),
  )

  const result = parseAllSchemas(entries)
  if (!result.success) {
    consola.error(result.error)
    return false
  }

  for (const warning of result.data.warnings) {
    consola.warn(warning)
  }

  await fs.mkdir(path.dirname(config.drizzleSchemaPath), { recursive: true })
  await fs.writeFile(config.drizzleSchemaPath, result.data.drizzleCode)
  consola.success(`Generated ${pc.cyan('.aiex/drizzle/schema.ts')} from ${schemaFiles.length} schema file(s)`)
  return true
}

async function migrate(config: MigrationConfig, migrationName?: string): Promise<boolean> {
  const helperPath = resolveHelperPath()
  const tsxPath = resolveTsxPath()
  const helperArgs = [tsxPath, helperPath, config.drizzleSchemaPath, config.migrationsPath, config.databasePath]
  if (migrationName)
    helperArgs.push(migrationName)

  try {
    const { stdout } = await execFileAsync(
      process.execPath,
      helperArgs,
      { cwd: process.cwd() },
    )

    const result = JSON.parse(stdout.trim())

    if (!result.success) {
      consola.error('Failed to generate migration')
      consola.error(result.error)
      return false
    }

    if (result.changes === 0) {
      consola.info(pc.gray('No changes detected'))
      return true
    }

    consola.success(pc.green('Migration files generated'))
    consola.success(pc.green('Database migrated'))
    return true
  }
  catch (error: unknown) {
    consola.error('Failed to generate migration')
    const execError = error as { stderr?: string, message?: string }
    if (execError.stderr)
      consola.error(execError.stderr)
    else consola.error(execError.message || String(error))
    return false
  }
}

export const schemaCommand = defineCommand({
  meta: {
    name: 'schema',
    description: 'Sync JSON Schema to SQLite database',
  },
  args: {
    init: {
      type: 'boolean',
      alias: 'i',
      description: 'Only initialize .aiex/ directory with example schema',
      default: false,
    },
    generate: {
      type: 'boolean',
      alias: 'g',
      description: 'Only generate Drizzle schema, skip migrate',
      default: false,
    },
    name: {
      type: 'string',
      description: 'Name for the migration',
    },
  },
  async run({ args }) {
    intro(pc.inverse(' aiex schema '))

    const cwd = process.cwd()
    const config = createMigrationConfig(cwd)

    if (args.init) {
      await fs.mkdir(config.schemaPath, { recursive: true })
      await fs.mkdir(path.dirname(config.drizzleSchemaPath), { recursive: true })
      await fs.mkdir(config.migrationsPath, { recursive: true })

      // Example: College entrance exam score report

      const examReportSchema = {
        $schema: (tableSchemaFile as { $id: string }).$id,
        title: 'ExamScoreReport',
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
          // Subject scores
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
          // Admission cutoff lines
          batchLineFirst: { type: 'integer', description: '本科第一批录取分数线' },
          batchLineSecond: { type: 'integer', description: '本科第二批录取分数线' },
        },
        required: ['name', 'examYear', 'examType', 'province', 'totalScore'],
      }

      const examStatus = await writeJsonIfAbsent(path.join(config.schemaPath, 'score_report.json'), examReportSchema)

      consola.success(`Initialized ${pc.cyan('.aiex/')} with example schemas`)
      if (examStatus === 'skipped')
        consola.warn(`${pc.cyan('.aiex/schema/score_report.json')} already exists, skipped`)
      consola.info('Example includes: ExamScoreReport (college entrance exam score report)')
      outro('Run: aiex schema')
      return
    }

    // Scan .aiex/schema/ for JSON Schema files
    let schemaFiles: string[]
    try {
      schemaFiles = await fs.readdir(config.schemaPath)
      schemaFiles = schemaFiles
        .filter(f => f.endsWith('.json'))
        .map(f => path.join(config.schemaPath, f))
    }
    catch {
      schemaFiles = []
    }

    if (schemaFiles.length === 0) {
      consola.info('Use --init to initialize with an example schema')
      fail(`No schema files found in ${pc.cyan('.aiex/schema/')}`)
      return
    }

    // Generate
    const s1 = spinner()
    s1.start('Generating Drizzle schema...')

    const genOk = await generateFromFiles(schemaFiles, config)
    s1.stop(genOk ? 'Schema generated' : 'Generation failed')

    if (!genOk) {
      fail()
      return
    }

    if (args.generate) {
      outro('Done! Run without --generate to apply migrations')
      return
    }

    // Migrate
    const s2 = spinner()
    s2.start('Running migrations...')
    const migOk = await migrate(config, args.name)
    s2.stop(migOk ? 'Migrations applied' : 'Migration failed')

    if (!migOk) {
      fail()
      return
    }

    outro('Done!')
  },
})
