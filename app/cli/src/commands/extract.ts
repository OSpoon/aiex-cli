import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { intro, outro, spinner } from '@clack/prompts'
import { defineCommand } from 'citty'
import { consola } from 'consola'
import pc from 'picocolors'
import { ZodError } from 'zod'
import { extractStructuredData, readAIConfig } from '@/core/ai-extraction'
import {
  createMigrationConfig,
  JsonSchemaDefinitionSchema,
} from '@/core/schema-sqlite'

const IMAGE_EXTENSIONS = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'bmp',
  'svg',
])

export const extractCommand = defineCommand({
  meta: {
    name: 'extract',
    description: 'Extract structured data from text or files (images/PDFs)',
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
      description: 'File path (text/image/PDF) to extract from',
    },
  },
  async run({ args }) {
    intro(pc.inverse(' aiex extract '))

    const cwd = process.cwd()
    const config = createMigrationConfig(cwd)
    const aiexDir = path.dirname(config.schemaPath)

    if (!args.text && !args.file) {
      consola.error('Please provide text (-t) or a file (-f) to extract from')
      outro('Failed!')
      return
    }

    if (args.text && args.file) {
      consola.error('-t and -f cannot be used together')
      outro('Failed!')
      return
    }

    // Read AI config
    const aiConfig = await readAIConfig(aiexDir)
    if (!aiConfig) {
      consola.error('AI configuration not found. Please configure AI settings in the Web interface first')
      outro('Failed!')
      return
    }

    if (!aiConfig.provider.apiKey) {
      consola.error('API Key not configured. Please configure AI settings in the Web interface first')
      outro('Failed!')
      return
    }

    if (!aiConfig.provider.models?.length) {
      consola.error('No models configured. Please add at least one model in AI Settings')
      outro('Failed!')
      return
    }

    // Determine mode: text or file
    let text = ''
    let filePath: string | undefined

    if (args.file) {
      const ext = path.extname(args.file as string).toLowerCase().replace('.', '')
      if (IMAGE_EXTENSIONS.has(ext)) {
        filePath = args.file as string
      }
      else {
        try {
          text = await fs.readFile(args.file as string, 'utf-8')
        }
        catch {
          consola.error(`Cannot read file: ${args.file}`)
          outro('Failed!')
          return
        }
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
      consola.error(`Cannot read schema file: ${schemaName}.json`)
      outro('Failed!')
      return
    }

    try {
      JsonSchemaDefinitionSchema.parse(schema)
    }
    catch (e) {
      if (e instanceof ZodError) {
        consola.error(`Schema validation failed: ${schemaName}.json`)
        for (const issue of e.issues) {
          consola.error(`  - ${issue.path.join('.')}: ${issue.message}`)
        }
      }
      outro('Failed!')
      return
    }

    // Run extraction
    const s = spinner()
    s.start(filePath ? 'Extracting data from file...' : 'Extracting data...')

    const result = await extractStructuredData({
      config: aiConfig,
      schema,
      text,
      aiexDir,
      file: filePath,
    })

    if (!result.success) {
      s.stop('Extraction failed')
      consola.error(result.error || 'Unknown error')
      outro('Failed!')
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

    outro('Done!')
  },
})
