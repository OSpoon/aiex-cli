import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { intro, outro, spinner } from '@clack/prompts'
import Database from 'better-sqlite3'
import { defineCommand } from 'citty'
import { consola } from 'consola'
import pc from 'picocolors'
import { ZodError } from 'zod'
import { extractStructuredData, insertExtractedData, readAIConfig } from '@/core/ai-extraction'
import { createPdfConverter } from '@/core/pdf-converter'
import {
  createMigrationConfig,
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

const PDF_CONVERTER = createPdfConverter()

function fail(message?: string): void {
  if (message)
    consola.error(message)
  outro('Failed!')
  process.exitCode = 1
}

async function ensureDatabaseReady(dbPath: string, schema: any): Promise<string | null> {
  try {
    await fs.access(dbPath)
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

export const extractCommand = defineCommand({
  meta: {
    name: 'extract',
    description: 'Extract structured data from text, images, or PDFs',
  },
  args: {
    schema: {
      type: 'string',
      alias: 's',
      description: 'Schema name (without .json extension)',
      required: true,
    },
    text: {
      type: 'string',
      alias: 't',
      description: 'Text content to extract',
    },
    file: {
      type: 'string',
      alias: 'f',
      description: 'File path (image/PDF) to extract from',
    },
    model: {
      type: 'string',
      alias: 'm',
      description: 'AI model to use for extraction (overrides auto-selection)',
    },
    db: {
      type: 'boolean',
      alias: 'd',
      description: 'Insert extracted data into SQLite database',
      default: false,
    },
  },
  async run({ args }) {
    intro(pc.inverse(' aiex extract '))

    const cwd = process.cwd()
    const config = createMigrationConfig(cwd)
    const aiexDir = path.dirname(config.schemaPath)

    if (!args.text && !args.file) {
      fail('Please provide text (-t) or a file (-f) to extract from')
      return
    }

    if (args.text && args.file) {
      fail('-t and -f cannot be used together')
      return
    }

    // Read AI config
    const aiConfig = await readAIConfig(aiexDir)
    if (!aiConfig) {
      fail('AI configuration not found. Please configure AI settings in the Web interface first')
      return
    }

    if (!aiConfig.provider.apiKey) {
      fail('API Key not configured. Please configure AI settings in the Web interface first')
      return
    }

    if (!aiConfig.provider.models?.length) {
      fail('No models configured. Please add at least one model in AI Settings')
      return
    }

    // Resolve model override
    let modelOverride
    if (args.model) {
      const matched = aiConfig.provider.models.find(m => m.name === args.model)
      if (!matched) {
        const available = aiConfig.provider.models.map(m => m.name).join(', ')
        fail(`Model "${args.model}" not found in configuration. Available models: ${available}`)
        return
      }
      modelOverride = matched
    }

    // Determine mode: text or file
    let text = ''
    let filePath: string | undefined

    if (args.file) {
      const ext = path.extname(args.file as string).toLowerCase().replace('.', '')
      if (FILE_PART_EXTENSIONS.has(ext)) {
        filePath = args.file as string
      }
      else if (ext === 'pdf') {
        const buffer = await fs.readFile(args.file as string)
        const result = await PDF_CONVERTER.convert(buffer)
        text = result.text
        consola.info(`Extracted ${result.pageCount} page(s) from PDF`)
      }
      else {
        text = await fs.readFile(args.file as string, 'utf-8')
      }
    }
    else if (args.text) {
      text = args.text as string
    }

    // Read and validate schema
    const schemaName = args.schema as string
    const schemaPath = path.join(config.schemaPath, `${schemaName}.json`)

    let schema: any
    try {
      const content = await fs.readFile(schemaPath, 'utf-8')
      schema = JSON.parse(content)
    }
    catch {
      fail(`Cannot read schema file: ${schemaName}.json`)
      return
    }

    try {
      schema = JsonSchemaDefinitionSchema.parse(schema)
    }
    catch (e) {
      if (e instanceof ZodError) {
        consola.error(`Schema validation failed: ${schemaName}.json`)
        for (const issue of e.issues) {
          consola.error(`  - ${issue.path.join('.')}: ${issue.message}`)
        }
      }
      fail()
      return
    }

    // Run extraction
    const s = spinner()
    s.start(filePath ? 'Extracting data from image...' : 'Extracting data...')

    const result = await extractStructuredData({
      config: aiConfig,
      schema,
      text,
      aiexDir,
      file: filePath,
      modelOverride,
      onRetry(info) {
        s.message(`API responded with ${info.statusCode}, retrying in ${info.delayMs / 1000}s (${info.attempt}/${info.maxRetries})...`)
      },
    })

    if (!result.success) {
      s.stop('Extraction failed')
      fail(result.error || 'Unknown error')
      return
    }

    s.stop('Extraction complete')

    if (result.outputPath) {
      consola.success(`Result saved: ${pc.cyan(result.outputPath)}`)
    }

    if (result.tokensUsed) {
      consola.info(
        pc.gray(
          `Token usage: prompt=${result.tokensUsed.prompt}, completion=${result.tokensUsed.completion}, total=${result.tokensUsed.total}`,
        ),
      )
    }

    if (args.db && result.data) {
      const s2 = spinner()
      s2.start('Inserting into database...')

      const dbError = await ensureDatabaseReady(config.databasePath, schema)
      if (dbError) {
        s2.stop('Database not ready')
        fail(dbError)
        return
      }

      try {
        const db = new Database(config.databasePath)
        try {
          const insertResult = insertExtractedData(db, schema, result.data as Record<string, unknown>)
          if (insertResult.success) {
            s2.stop(`Inserted into ${insertResult.tablesInserted.length} table(s)`)
          }
          else {
            s2.stop('Database insert failed')
            fail(insertResult.error || 'Unknown error')
            return
          }
        }
        finally {
          db.close()
        }
      }
      catch (e) {
        s2.stop('Database insert failed')
        fail(e instanceof Error ? e.message : String(e))
        return
      }
    }

    outro('Done!')
  },
})
