import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { intro, outro, spinner } from '@clack/prompts'
import Database from 'better-sqlite3'
import { defineCommand } from 'citty'
import { consola } from 'consola'
import { readFile as readJsonFile } from 'jsonfile'
import pc from 'picocolors'
import { loadSchema } from '@/application/schema/load-schema'
import { failCommand } from '@/commands/utils'
import { formatRowsConformingToSchema, generateExportBuffer } from '@/core/export-manager'
import { createMigrationConfig } from '@/core/schema-sqlite'
import { initI18n, t } from '@/locales'

export const dumpCommand = defineCommand({
  meta: {
    name: 'dump',
    description: t('command.dump.description'),
  },
  args: {
    table: {
      type: 'string',
      alias: 't',
      description: t('command.dump.args.table'),
    },
    schema: {
      type: 'string',
      alias: 's',
      description: t('command.dump.args.schema'),
    },
    format: {
      type: 'string',
      alias: 'f',
      description: t('command.dump.args.format'),
    },
    output: {
      type: 'string',
      alias: 'o',
      description: t('command.dump.args.output'),
    },
  },
  async run({ args }) {
    intro(pc.inverse(' aiex dump '))
    await initI18n()

    if (!args.table && !args.schema) {
      failCommand(t('command.dump.errors.tableOrSchemaRequired'))
      return
    }

    const cwd = process.cwd()
    const config = createMigrationConfig(cwd)
    const schemaDir = config.schemaPath

    let tableName = args.table || ''
    let schema: any = null

    // 1. Resolve table name and schema
    if (args.schema) {
      const schemaLoad = await loadSchema(config, args.schema)
      if (!schemaLoad.schema) {
        failCommand(schemaLoad.error || t('command.dump.errors.schemaNotFound', { name: args.schema }))
        return
      }
      schema = schemaLoad.schema
      const tName = schema.table?.name
      if (!tName) {
        failCommand(t('command.dump.errors.noTableName', { name: args.schema }))
        return
      }
      if (tableName && tableName !== tName) {
        failCommand(t('command.dump.errors.tableMismatch', { table: tableName, schemaTable: tName }))
        return
      }
      tableName = tName
    }
    else {
      // Find matching schema file in schemaDir if table name is specified
      try {
        if (fs.existsSync(schemaDir)) {
          const files = fs.readdirSync(schemaDir).filter(f => f.endsWith('.json'))
          for (const file of files) {
            const s = await readJsonFile(path.join(schemaDir, file))
            if (s.table?.name === tableName) {
              schema = s
              break
            }
          }
        }
      }
      catch {
        // Fallback: continue without schema (we will use DB columns only)
      }
    }

    // 2. Determine format and output path
    let format = args.format?.toLowerCase()
    const outputPathArg = args.output

    if (outputPathArg) {
      const ext = path.extname(outputPathArg).toLowerCase()
      if (!format) {
        if (ext === '.xlsx')
          format = 'xlsx'
        else if (ext === '.csv')
          format = 'csv'
      }
    }

    if (!format) {
      format = 'csv'
    }

    if (format !== 'csv' && format !== 'xlsx') {
      failCommand(t('command.dump.errors.unsupportedFormat', { format }))
      return
    }

    const resolvedOutput = outputPathArg
      ? path.resolve(outputPathArg)
      : path.resolve(cwd, `${tableName}.${format}`)

    // 3. Connect to Database and query records
    if (!fs.existsSync(config.databasePath)) {
      failCommand(t('command.dump.errors.dbNotFound', { path: config.databasePath, cmd: 'aiex schema' }))
      return
    }

    const s = spinner()
    s.start(t('command.dump.loading', { name: tableName }))

    let columns: any[] = []
    let rows: any[] = []

    try {
      const db = new Database(config.databasePath, { readonly: true })

      // Verify table exists
      const tableCheck = db.prepare(`
        select name from sqlite_master
        where type = 'table' and name = ?
      `).get(tableName)

      if (!tableCheck) {
        s.stop(t('command.dump.dbQueryFailed'))
        failCommand(t('command.dump.errors.tableNotFound', { name: tableName, cmd: 'aiex schema' }))
        db.close()
        return
      }

      columns = db.pragma(`table_info(${tableName})`) as any[]
      rows = db.prepare(`select * from ${tableName}`).all()
      db.close()
    }
    catch (error) {
      s.stop(t('command.dump.dbQueryFailed'))
      failCommand(error instanceof Error ? error.message : String(error))
      return
    }

    if (rows.length === 0) {
      s.stop(t('command.dump.emptyTable'))
      consola.warn(t('command.dump.errors.tableEmpty', { name: tableName }))
    }
    else {
      s.stop(t('command.dump.loaded', { count: rows.length }))
    }

    // 4. Format rows conforming to Schema
    const s2 = spinner()
    s2.start(t('command.dump.formatting'))

    let formattedRows: any[]
    try {
      formattedRows = formatRowsConformingToSchema(rows, columns, schema, format as 'csv' | 'xlsx')
      s2.stop(t('command.dump.formatted'))
    }
    catch (error) {
      s2.stop(t('command.dump.dbQueryFailed'))
      failCommand(error instanceof Error ? error.message : String(error))
      return
    }

    // 5. Generate and write the output file
    const s3 = spinner()
    s3.start(t('command.dump.writing', { format: format.toUpperCase(), path: resolvedOutput }))

    try {
      const buffer = generateExportBuffer(tableName, formattedRows, columns, format as 'csv' | 'xlsx')

      const outputDir = path.dirname(resolvedOutput)
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true })
      }

      fs.writeFileSync(resolvedOutput, buffer)
      s3.stop(t('command.dump.dumpCompleted'))
      consola.success(t('command.dump.successMsg', { count: rows.length, path: pc.cyan(resolvedOutput) }))
    }
    catch (error) {
      s3.stop(t('command.dump.fileWriteFailed'))
      failCommand(error instanceof Error ? error.message : String(error))
      return
    }

    outro(t('common.done'))
  },
})
