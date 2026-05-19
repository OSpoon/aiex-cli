import type { AIConfig, AIModelConfig } from '@/core/ai-extraction/types'
import path from 'node:path'
import process from 'node:process'
import { intro, isCancel, outro, select, text } from '@clack/prompts'
import { defineCommand } from 'citty'
import { consola } from 'consola'
import pc from 'picocolors'
import { readAIConfig } from '@/core/ai-extraction'
import {
  extractSingle,
  listSchemas,
  readExtractFileInput,
  runBatchExtraction,
} from '@/core/extract-runner'
import {
  createMigrationConfig,
} from '@/core/schema-sqlite'

function fail(message?: string): void {
  if (message)
    consola.error(message)
  outro('Failed!')
  process.exitCode = 1
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
    dir: {
      type: 'string',
      alias: 'd',
      description: 'Directory containing files to batch extract',
    },
    glob: {
      type: 'string',
      alias: 'g',
      description: 'Glob pattern to filter files in batch mode (e.g. "*.pdf")',
    },
  },
  async run({ args }) {
    intro(pc.inverse(' aiex extract '))

    const cwd = process.cwd()
    const config = createMigrationConfig(cwd)
    const aiexDir = path.dirname(config.schemaPath)

    // ── Arg conflict validation ──
    if (args.dir && args.text) {
      fail('Cannot combine -t/--text with -d/--dir')
      return
    }
    if (args.dir && args.file) {
      fail('Cannot combine -f/--file with -d/--dir')
      return
    }

    // Read AI config early
    const aiConfig = await readAIConfig(aiexDir)
    if (!aiConfig) {
      fail('AI configuration not found. Please run "aiex web" to configure AI settings first')
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
    let modelOverride: AIModelConfig | undefined
    if (args.model) {
      const matched = aiConfig.provider.models.find(m => m.name === args.model)
      if (!matched) {
        const available = aiConfig.provider.models.map(m => m.name).join(', ')
        fail(`Model "${args.model}" not found in configuration. Available models: ${available}`)
        return
      }
      modelOverride = matched
    }

    // ── Interactive mode (when no args provided) ──
    if (!args.schema && !args.text && !args.file && !args.dir) {
      const ok = await runInteractive(aiexDir, config, aiConfig, modelOverride)
      if (ok) {
        outro('Done!')
      }
      return
    }

    // ── Batch mode ──
    if (args.dir) {
      if (!args.schema) {
        fail('Schema name (-s) is required in batch mode')
        return
      }
      const result = await runBatchExtraction(aiexDir, config, aiConfig, args.schema as string, args.dir as string, args.glob as string | undefined, modelOverride)
      if (!result.ok) {
        fail(result.error)
        return
      }
      if (result.failCount > 0) {
        process.exitCode = 1
      }
      if (result.failCount > 0)
        outro(`Completed with failures (${result.failCount} failed)`)
      else
        outro('Done!')
      return
    }

    // ── Single extraction mode ──
    if (!args.schema) {
      fail('Please provide a schema name (-s) to extract from')
      return
    }

    if (!args.text && !args.file) {
      fail('Please provide text (-t) or a file (-f) to extract from')
      return
    }

    if (args.text && args.file) {
      fail('-t and -f cannot be used together')
      return
    }

    let text = ''
    let filePath: string | undefined

    if (args.file) {
      try {
        const input = await readExtractFileInput(args.file as string)
        text = input.text
        filePath = input.filePath
      }
      catch (e) {
        fail(`Cannot read file: ${args.file} — ${e instanceof Error ? e.message : String(e)}`)
        return
      }
    }
    else if (args.text) {
      text = args.text as string
    }

    const r = await extractSingle(aiexDir, config, aiConfig, args.schema as string, text, filePath, modelOverride)
    if (!r.success) {
      fail()
      return
    }

    outro('Done!')
  },
})

async function runInteractive(
  aiexDir: string,
  config: ReturnType<typeof createMigrationConfig>,
  aiConfig: AIConfig,
  modelOverride: AIModelConfig | undefined,
): Promise<boolean> {
  const schemas = await listSchemas(aiexDir)
  if (schemas.length === 0) {
    fail(`No schema files found in ${pc.cyan('.aiex/schema/')}. Run ${pc.cyan('aiex schema --init')} first, or add JSON Schema files.`)
    return false
  }

  const schemaName = await select({
    message: 'Select a schema to extract data for:',
    options: schemas.map(s => ({ label: s, value: s })),
  })

  if (isCancel(schemaName)) {
    cancel('Cancelled')
    return false
  }

  const inputSource = await select({
    message: 'Choose input source:',
    options: [
      { label: 'Text content', value: 'text', hint: 'Paste or type text directly' },
      { label: 'Single file', value: 'file', hint: 'Extract from a file (txt, pdf, image)' },
      { label: 'Batch directory', value: 'dir', hint: 'Extract all supported files in a directory' },
    ],
  })

  if (isCancel(inputSource)) {
    cancel('Cancelled')
    return false
  }

  if (inputSource === 'text') {
    const textContent = await text({
      message: 'Enter text content to extract:',
      validate(value) {
        if (!value || value.trim().length === 0)
          return 'Please enter some text'
        return undefined
      },
    })

    if (isCancel(textContent)) {
      cancel('Cancelled')
      return false
    }

    const r = await extractSingle(aiexDir, config, aiConfig, schemaName as string, textContent as string, undefined, modelOverride)
    return r.success
  }
  else if (inputSource === 'file') {
    const filePathStr = await text({
      message: 'Enter file path:',
      validate(value) {
        if (!value || value.trim().length === 0)
          return 'Please enter a file path'
        return undefined
      },
    })

    if (isCancel(filePathStr)) {
      cancel('Cancelled')
      return false
    }

    const fp = filePathStr as string

    try {
      const input = await readExtractFileInput(fp)
      const r = await extractSingle(aiexDir, config, aiConfig, schemaName as string, input.text, input.filePath, modelOverride)
      return r.success
    }
    catch (e) {
      consola.error(`Cannot read file: ${fp} — ${e instanceof Error ? e.message : String(e)}`)
      return false
    }
  }
  else if (inputSource === 'dir') {
    const dirPath = await text({
      message: 'Enter directory path:',
      validate(value) {
        if (!value || value.trim().length === 0)
          return 'Please enter a directory path'
        return undefined
      },
    })

    if (isCancel(dirPath)) {
      cancel('Cancelled')
      return false
    }

    const result = await runBatchExtraction(aiexDir, config, aiConfig, schemaName as string, dirPath as string, undefined, modelOverride)
    if (!result.ok)
      fail(result.error)
    return result.ok && result.failCount === 0
  }

  return false
}

function cancel(msg: string): void {
  consola.info(msg)
  outro('Cancelled')
  process.exitCode = 0
}
