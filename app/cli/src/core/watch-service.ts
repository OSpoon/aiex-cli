import type { FSWatcher } from 'chokidar'
import type { AIConfig, AIModelConfig } from '@/core/ai-extraction/types'
import type { createMigrationConfig } from '@/core/schema-sqlite'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import * as chokidar from 'chokidar'
import { consola } from 'consola'
import { execa } from 'execa'
import pc from 'picocolors'
import { processOneFile } from '@/application/extraction'
import { t } from '@/locales'
import { getFileHash } from '@/utils/hash'

const PDF_EXT_REGEXP = /\.pdf$/i

const SUPPORTED_EXTENSIONS = new Set([
  'png',
  'jpg',
  'jpeg',
  'webp',
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
        `display notification "${t('command.watch.notification.success')}" with title "${t('command.watch.notification.successTitle', { file: fileName })}"`,
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
        `display notification "${sanitizedMsg}" with title "${t('command.watch.notification.failTitle', { file: fileName })}"`,
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

  consola.info(pc.green(t('command.watch.starting.watchFolder', { dir: pc.cyan(watchDir) })))
  consola.info(pc.green(t('command.watch.starting.schema', { name: pc.cyan(schemaName) })))
  if (modelOverride) {
    consola.info(pc.green(t('command.watch.starting.modelOverride', { name: pc.cyan(modelOverride.name) })))
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
      consola.warn(t('command.watch.events.skippedUnsupported', { file: path.basename(resolvedPath) }))
      return
    }

    const fileName = path.basename(resolvedPath)
    consola.info(t('command.watch.events.fileDetected', { file: pc.cyan(fileName) }))

    try {
      const hash = await getFileHash(resolvedPath)
      const existingStatus = await registry.getStatus(hash)

      if (existingStatus === 'succeeded') {
        consola.info(t('command.watch.events.alreadyProcessed', { file: pc.cyan(fileName), hash: hash.slice(0, 8) }))
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
        consola.success(t('command.watch.events.processedSuccess', { file: pc.green(fileName) }))
        await notifySuccess(fileName)
      }
      else {
        const errorMsg = t('command.watch.events.extractionFailed')
        await registry.markFailed(hash, resolvedPath, errorMsg)
        // Move to failed staging queue
        const failedQueuePath = path.join(queueDirFailed, `${hash}-${Date.now()}.${ext}`)
        await fsp.rename(activeQueuePath, failedQueuePath).catch(() => {})
        // Clean up markdown companion if generated
        await fsp.rm(activeQueuePath.replace(PDF_EXT_REGEXP, '.md'), { force: true }).catch(() => {})
        consola.error(t('command.watch.events.processingFailed', { file: pc.red(fileName) }))
        await notifyFailure(fileName, errorMsg)
      }
    }
    catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e)
      consola.error(t('command.watch.events.errorProcessing', { file: fileName, error: errorMsg }))
      await notifyFailure(fileName, errorMsg)
    }
  })

  watcher.on('error', (error: any) => {
    consola.error(t('command.watch.events.watcherError', { error: error?.message || String(error) }))
  })

  return watcher
}
