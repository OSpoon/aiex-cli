import type { FSWatcher } from 'chokidar'
import type { AIConfig, AIModelConfig } from '@/core/ai-extraction/types'
import type { createMigrationConfig } from '@/core/schema-sqlite'
import crypto from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import * as chokidar from 'chokidar'
import { consola } from 'consola'
import { execa } from 'execa'
import pc from 'picocolors'
import { processOneFile } from './extract-runner'

const PDF_EXT_REGEXP = /\.pdf$/i

const SUPPORTED_EXTENSIONS = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'bmp',
  'svg',
  'pdf',
  'txt',
  'md',
  'csv',
  'json',
  'html',
  'xml',
  'yaml',
  'yml',
])

interface RegistryItem {
  filePath: string
  fileName: string
  processedAt: string
  status: 'succeeded' | 'failed'
  error?: string
}

interface RegistryData {
  processed: Record<string, RegistryItem>
}

// Helper to compute SHA-256 hash of a file
export function getFileHash(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256')
    const stream = fs.createReadStream(filePath)
    stream.on('data', data => hash.update(data))
    stream.on('end', () => resolve(hash.digest('hex')))
    stream.on('error', err => reject(err))
  })
}

// WatchRegistry handles tracking of processed files in `.aiex/watch-registry.json`
export class WatchRegistry {
  private readonly registryPath: string

  constructor(aiexDir: string) {
    this.registryPath = path.join(aiexDir, 'watch-registry.json')
  }

  async load(): Promise<RegistryData> {
    try {
      const content = await fsp.readFile(this.registryPath, 'utf-8')
      return JSON.parse(content) as RegistryData
    }
    catch {
      return { processed: {} }
    }
  }

  async save(data: RegistryData): Promise<void> {
    await fsp.mkdir(path.dirname(this.registryPath), { recursive: true })
    await fsp.writeFile(this.registryPath, JSON.stringify(data, null, 2), 'utf-8')
  }

  async markSucceeded(hash: string, filePath: string): Promise<void> {
    const data = await this.load()
    data.processed[hash] = {
      filePath,
      fileName: path.basename(filePath),
      processedAt: new Date().toISOString(),
      status: 'succeeded',
    }
    await this.save(data)
  }

  async markFailed(hash: string, filePath: string, error: string): Promise<void> {
    const data = await this.load()
    data.processed[hash] = {
      filePath,
      fileName: path.basename(filePath),
      processedAt: new Date().toISOString(),
      status: 'failed',
      error,
    }
    await this.save(data)
  }

  async getStatus(hash: string): Promise<'succeeded' | 'failed' | null> {
    const data = await this.load()
    return data.processed[hash]?.status ?? null
  }
}

// Notify success/failure
async function notifySuccess(fileName: string): Promise<void> {
  if (process.platform === 'darwin') {
    try {
      await execa('osascript', [
        '-e',
        `display notification "Successfully processed and inserted data." with title "AIEX Watch: ${fileName}"`,
      ])
      await execa('afplay', ['/System/Library/Sounds/Glass.aiff'])
    }
    catch {
      // Ignore notification failures
    }
  }
  else {
    process.stdout.write('\u0007') // Beep
  }
}

async function notifyFailure(fileName: string, errorMessage: string): Promise<void> {
  if (process.platform === 'darwin') {
    try {
      const sanitizedMsg = errorMessage.replace(/"/g, '\\"')
      await execa('osascript', [
        '-e',
        `display notification "${sanitizedMsg}" with title "AIEX Watch Failed: ${fileName}"`,
      ])
      await execa('afplay', ['/System/Library/Sounds/Basso.aiff'])
    }
    catch {
      // Ignore notification failures
    }
  }
  else {
    process.stdout.write('\u0007\u0007') // Beep twice
  }
}

export interface WatchOptions {
  aiexDir: string
  config: ReturnType<typeof createMigrationConfig>
  aiConfig: AIConfig
  schemaName: string
  watchDir: string
  modelOverride?: AIModelConfig
  insert?: boolean
}

export function startWatcher(options: WatchOptions): FSWatcher {
  const { aiexDir, config, aiConfig, schemaName, watchDir, modelOverride, insert } = options

  const queueDirActive = path.join(aiexDir, 'watch-queue', 'active')
  const queueDirFailed = path.join(aiexDir, 'watch-queue', 'failed')
  const registry = new WatchRegistry(aiexDir)

  // Ensure queue directories exist
  fs.mkdirSync(queueDirActive, { recursive: true })
  fs.mkdirSync(queueDirFailed, { recursive: true })

  consola.info(pc.green(`Starting watch on folder: ${pc.cyan(watchDir)}`))
  consola.info(pc.green(`Schema: ${pc.cyan(schemaName)}`))
  if (modelOverride) {
    consola.info(pc.green(`Model Override: ${pc.cyan(modelOverride.name)}`))
  }

  const watcher = chokidar.watch(watchDir, {
    persistent: true,
    ignoreInitial: false,
    awaitWriteFinish: {
      stabilityThreshold: 2000,
      pollInterval: 500,
    },
  })

  watcher.on('add', async (filePath) => {
    // Avoid watching directories or our own queue dir
    const resolvedPath = path.resolve(filePath)
    if (resolvedPath.startsWith(path.resolve(aiexDir))) {
      return
    }

    const stat = await fsp.stat(resolvedPath).catch(() => null)
    if (!stat || !stat.isFile()) {
      return
    }

    const ext = path.extname(resolvedPath).toLowerCase().replace('.', '')
    if (!SUPPORTED_EXTENSIONS.has(ext)) {
      consola.warn(`[Watcher] Skipped unsupported file type: ${path.basename(resolvedPath)}`)
      return
    }

    const fileName = path.basename(resolvedPath)
    consola.info(`[Watcher] New file detected: ${pc.cyan(fileName)}. Processing...`)

    try {
      const hash = await getFileHash(resolvedPath)
      const existingStatus = await registry.getStatus(hash)

      if (existingStatus === 'succeeded') {
        consola.info(`[Watcher] File ${pc.cyan(fileName)} (hash: ${hash.slice(0, 8)}) has already been processed successfully. Skipping.`)
        return
      }

      // Copy file to active staging queue
      const activeQueuePath = path.join(queueDirActive, `${hash}.${ext}`)
      await fsp.copyFile(resolvedPath, activeQueuePath)

      // Run extraction on staging file
      const success = await processOneFile(
        aiexDir,
        config,
        aiConfig,
        schemaName,
        activeQueuePath,
        modelOverride,
        { insert },
      )

      if (success) {
        await registry.markSucceeded(hash, resolvedPath)
        // Clean up active staging copy
        await fsp.rm(activeQueuePath, { force: true }).catch(() => {})
        // Also remove any generated PDF companion markdown file from the queue folder
        await fsp.rm(activeQueuePath.replace(PDF_EXT_REGEXP, '.md'), { force: true }).catch(() => {})
        consola.success(`[Watcher] File processed successfully: ${pc.green(fileName)}`)
        await notifySuccess(fileName)
      }
      else {
        const errorMsg = 'Extraction failed. See extraction audit history.'
        await registry.markFailed(hash, resolvedPath, errorMsg)
        // Move to failed staging queue
        const failedQueuePath = path.join(queueDirFailed, `${hash}-${Date.now()}.${ext}`)
        await fsp.rename(activeQueuePath, failedQueuePath).catch(() => {})
        // Clean up markdown companion if generated
        await fsp.rm(activeQueuePath.replace(PDF_EXT_REGEXP, '.md'), { force: true }).catch(() => {})
        consola.error(`[Watcher] Processing failed for: ${pc.red(fileName)}`)
        await notifyFailure(fileName, errorMsg)
      }
    }
    catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e)
      consola.error(`[Watcher] Error processing file ${fileName}: ${errorMsg}`)
      await notifyFailure(fileName, errorMsg)
    }
  })

  watcher.on('error', (error: any) => {
    consola.error(`[Watcher] Watcher error: ${error?.message || String(error)}`)
  })

  return watcher
}
