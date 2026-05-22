import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { intro, outro, spinner } from '@clack/prompts'
import Database from 'better-sqlite3'
import { defineCommand } from 'citty'
import { consola } from 'consola'
import { readFile as readJsonFile } from 'jsonfile'
import pc from 'picocolors'
import * as XLSX from 'xlsx'
import { failCommand } from '@/commands/utils'
import { loadSchema } from '@/core/extract-runner'
import { createMigrationConfig } from '@/core/schema-sqlite'

export const dumpCommand = defineCommand({
  meta: {
    name: 'dump',
    description: 'Dump SQLite database table to Excel (.xlsx) or CSV (.csv)',
  },
  args: {
    table: {
      type: 'string',
      alias: 't',
      description: 'SQLite table name to export',
    },
    schema: {
      type: 'string',
      alias: 's',
      description: 'Schema name (without .json extension) to export',
    },
    format: {
      type: 'string',
      alias: 'f',
      description: 'Export format: csv or xlsx (default: inferred from output or csv)',
    },
    output: {
      type: 'string',
      alias: 'o',
      description: 'Output file path (default: ./<tableName>.<format>)',
    },
  },
  async run({ args }) {
    intro(pc.inverse(' aiex dump '))

    if (!args.table && !args.schema) {
      failCommand('Either table name (--table / -t) or schema name (--schema / -s) is required')
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
        failCommand(schemaLoad.error || `Schema file for "${args.schema}" not found`)
        return
      }
      schema = schemaLoad.schema
      const tName = schema.table?.name
      if (!tName) {
        failCommand(`Schema "${args.schema}" does not define a database table name.`)
        return
      }
      if (tableName && tableName !== tName) {
        failCommand(`Specified table name "${tableName}" does not match schema table name "${tName}"`)
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
      failCommand(`Unsupported dump format: "${format}". Supported formats: csv, xlsx`)
      return
    }

    const resolvedOutput = outputPathArg
      ? path.resolve(outputPathArg)
      : path.resolve(cwd, `${tableName}.${format}`)

    // 3. Connect to Database and query records
    if (!fs.existsSync(config.databasePath)) {
      failCommand(`Database file not found at ${config.databasePath}. Please run "aiex schema" to create the database first.`)
      return
    }

    const s = spinner()
    s.start(`Loading data from table "${tableName}"...`)

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
        s.stop('Database query failed')
        failCommand(`Table "${tableName}" not found in database. Run "aiex schema" first to migrate.`)
        db.close()
        return
      }

      columns = db.pragma(`table_info(${tableName})`) as any[]
      rows = db.prepare(`select * from ${tableName}`).all()
      db.close()
    }
    catch (error) {
      s.stop('Database query failed')
      failCommand(error instanceof Error ? error.message : String(error))
      return
    }

    if (rows.length === 0) {
      s.stop('Empty table')
      consola.warn(`Table "${tableName}" is empty. Exporting empty file...`)
    }
    else {
      s.stop(`Loaded ${rows.length} row(s)`)
    }

    // 4. Format rows conforming to Schema
    const s2 = spinner()
    s2.start('Formatting data...')

    const formattedRows = rows.map((row: any) => {
      const newRow: Record<string, any> = {}
      columns.forEach((col) => {
        const colName = col.name
        const val = row[colName]

        // Look up schema type
        const prop = schema?.properties?.[colName]
        const type = prop?.type || ''

        if (val === null || val === undefined) {
          newRow[colName] = ''
        }
        else if (type === 'boolean') {
          // SQLite stores booleans as 0 or 1
          if (format === 'xlsx') {
            newRow[colName] = val === 1 || val === '1' || val === true
          }
          else {
            newRow[colName] = (val === 1 || val === '1' || val === true) ? 'true' : 'false'
          }
        }
        else if (type === 'number' || type === 'integer') {
          if (val === '') {
            newRow[colName] = ''
          }
          else {
            const num = Number(val)
            newRow[colName] = Number.isNaN(num) ? val : num
          }
        }
        else if (typeof val === 'object') {
          newRow[colName] = JSON.stringify(val)
        }
        else {
          // If SQLite type info implies numeric, ensure it's exported as number in XLSX
          const dbType = (col.type || '').toLowerCase()
          const isNumericDb = dbType.includes('int') || dbType.includes('real') || dbType.includes('num') || dbType.includes('double') || dbType.includes('float')
          if (isNumericDb && typeof val === 'string' && val !== '') {
            const num = Number(val)
            newRow[colName] = Number.isNaN(num) ? val : num
          }
          else {
            newRow[colName] = val
          }
        }
      })
      return newRow
    })

    s2.stop('Data formatted')

    // 5. Generate and write the output file
    const s3 = spinner()
    s3.start(`Writing ${format.toUpperCase()} file to ${resolvedOutput}...`)

    try {
      const ws = XLSX.utils.json_to_sheet(formattedRows, { header: columns.map(col => col.name) })
      const outputDir = path.dirname(resolvedOutput)
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true })
      }

      if (format === 'xlsx') {
        const wb = XLSX.utils.book_new()
        XLSX.utils.book_append_sheet(wb, ws, tableName.slice(0, 31)) // Sheet name max 31 chars
        XLSX.writeFile(wb, resolvedOutput)
      }
      else {
        const csv = XLSX.utils.sheet_to_csv(ws)
        const bom = '\uFEFF'
        fs.writeFileSync(resolvedOutput, bom + csv, 'utf8')
      }
      s3.stop('Dump completed successfully')
      consola.success(`Successfully dumped ${rows.length} row(s) to ${pc.cyan(resolvedOutput)}`)
    }
    catch (error) {
      s3.stop('File write failed')
      failCommand(error instanceof Error ? error.message : String(error))
      return
    }

    outro('Done!')
  },
})
