import type { PdfConversionResult, PdfConverter } from './types'
import type { ExternalPdfConverterConfig } from '@/core/ai-extraction/types'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execa } from 'execa'
import { glob } from 'tinyglobby'

interface TemplateContext {
  input: string
  outputDir: string
  basename: string
}

function applyTemplate(value: string, context: TemplateContext): string {
  return value
    .replaceAll('{input}', context.input)
    .replaceAll('{outputDir}', context.outputDir)
    .replaceAll('{basename}', context.basename)
}

function isError(error: unknown): error is Error {
  return error instanceof Error
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath)
    return true
  }
  catch {
    return false
  }
}

async function collectMarkdownFiles(dir: string): Promise<string[]> {
  return (await glob('**/*.md', {
    cwd: dir,
    absolute: true,
    onlyFiles: true,
  })).sort()
}

async function selectMarkdownFile(outputDir: string, basename: string): Promise<string> {
  const files = await collectMarkdownFiles(outputDir)
  if (files.length === 0) {
    throw new Error(`External PDF converter did not produce a markdown file in ${outputDir}`)
  }

  const preferredName = `${basename}.md`.toLowerCase()
  return files.find(file => path.basename(file).toLowerCase() === preferredName) ?? files[0]
}

function formatCommandError(error: unknown, command: string): Error {
  if (!isError(error))
    return new Error(String(error))

  const details: string[] = [`External PDF converter failed: ${command}`]
  if ('exitCode' in error && typeof error.exitCode === 'number')
    details.push(`exitCode=${error.exitCode}`)
  if ('signal' in error && error.signal)
    details.push(`signal=${String(error.signal)}`)
  if ('stderr' in error && typeof error.stderr === 'string' && error.stderr.trim())
    details.push(error.stderr.trim())
  else if (error.message)
    details.push(error.message)

  return new Error(details.join('\n'))
}

export class ExternalCommandPdfConverter implements PdfConverter {
  readonly name: string

  constructor(
    name: string,
    private readonly config: ExternalPdfConverterConfig,
  ) {
    this.name = name
  }

  async convert(input: Uint8Array, filePath?: string): Promise<PdfConversionResult> {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'aiex-pdf-'))
    const outputDir = path.join(tempRoot, 'output')
    await fs.mkdir(outputDir, { recursive: true })

    const inputPath = filePath ?? path.join(tempRoot, 'input.pdf')
    if (!filePath)
      await fs.writeFile(inputPath, input)

    const basename = path.basename(inputPath, path.extname(inputPath))
    const context = { input: inputPath, outputDir, basename }
    const args = this.config.args.map(arg => applyTemplate(arg, context))
    const timeoutMs = (this.config.timeout ?? 600) * 1000

    try {
      await execa(this.config.command, args, {
        shell: false,
        timeout: timeoutMs,
        maxBuffer: 1024 * 1024 * 20,
      })

      const outputPath = this.config.outputFile
        ? applyTemplate(this.config.outputFile, context)
        : await selectMarkdownFile(outputDir, basename)

      if (!await pathExists(outputPath)) {
        throw new Error(`External PDF converter output was not found: ${outputPath}`)
      }

      return {
        text: await fs.readFile(outputPath, 'utf-8'),
        pageCount: 0,
        metadata: {
          converter: this.name,
          outputPath,
          ...(this.config.keepOutput ? { outputDir } : {}),
        },
      }
    }
    catch (error) {
      throw formatCommandError(error, `${this.config.command} ${args.join(' ')}`)
    }
    finally {
      if (!this.config.keepOutput) {
        await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {})
      }
    }
  }
}
