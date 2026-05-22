import type { DoctorDiagnostics } from '@/core/doctor'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { createConfig } from '@/config'
import { readAIConfig } from '@/core/ai-extraction/config'
import { buildDoctorDiagnostics } from '@/core/doctor'
import { checkImageOcrAvailability } from '@/core/image-ocr'
import { createMigrationConfig } from '@/core/schema-sqlite'
import pkg from '~/package.json'

const V1_SUFFIX_RE = /\/v1\/?$/
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url))

export interface CollectDoctorDiagnosticsOptions {
  config?: ReturnType<typeof createConfig>
}

async function checkConnection(baseURL: string): Promise<boolean | null> {
  try {
    const base = baseURL.replace(V1_SUFFIX_RE, '')
    const res = await fetch(`${base}/v1/models`, {
      signal: AbortSignal.timeout(5000),
    })
    return res.ok
  }
  catch {
    return false
  }
}

async function findImageOcrSelfCheckLogo(): Promise<string | undefined> {
  const candidates = [
    path.resolve(MODULE_DIR, 'logo.png'),
    path.resolve(MODULE_DIR, 'assets/logo.png'),
    path.resolve(MODULE_DIR, '../../assets/logo.png'),
    path.resolve(MODULE_DIR, '../../../web/public/logo.png'),
    path.resolve(MODULE_DIR, '../../web/public/logo.png'),
    path.resolve(MODULE_DIR, '../../dist/web/logo.png'),
    path.resolve(MODULE_DIR, 'web/logo.png'),
  ]

  for (const candidate of candidates) {
    try {
      await fs.access(candidate)
      return candidate
    }
    catch {
      // try next candidate
    }
  }
  return undefined
}

export async function collectDoctorDiagnostics(
  options: CollectDoctorDiagnosticsOptions = {},
): Promise<DoctorDiagnostics> {
  const config = options.config ?? createConfig()
  const cwd = process.cwd()
  const errors: string[] = []
  const imageOcrLogoPath = await findImageOcrSelfCheckLogo()

  const migConfig = createMigrationConfig(cwd)
  const aiexDir = path.dirname(migConfig.schemaPath)
  const dirExists = await fs.stat(aiexDir).then(s => s.isDirectory()).catch(() => false)

  let schemaFiles: string[] = []
  if (dirExists) {
    try {
      const schemaDir = migConfig.schemaPath
      const entries = await fs.readdir(schemaDir).catch(() => [])
      schemaFiles = entries.filter(f => f.endsWith('.json')).sort()
    }
    catch {
      errors.push('Could not read schema directory')
    }
  }

  let aiConfig = false
  let aiApiKeySet = false
  let aiModelCount = 0
  let aiModels: string[] = []
  let aiProvider: string | null = null
  let aiConnectionOk: boolean | null = null

  if (dirExists) {
    const cfg = await readAIConfig(aiexDir)
    if (cfg) {
      aiConfig = true
      aiApiKeySet = Boolean(cfg.provider.apiKey)
      aiModelCount = cfg.provider.models?.length ?? 0
      aiModels = cfg.provider.models?.map(m => m.name) ?? []
      aiProvider = cfg.provider.baseURL
      aiConnectionOk = await checkConnection(cfg.provider.baseURL)
    }
  }

  let dbExists = false
  if (dirExists) {
    try {
      const stat = await fs.stat(migConfig.databasePath)
      dbExists = stat.isFile()
    }
    catch {
      dbExists = false
    }
  }

  let migrationCount = 0
  if (dirExists) {
    try {
      const entries = await fs.readdir(migConfig.migrationsPath).catch(() => [])
      migrationCount = entries.filter(f => f.endsWith('.sql')).length
    }
    catch {
      // no migrations dir
    }
  }

  return buildDoctorDiagnostics({
    pkg: { name: pkg.name, version: pkg.version },
    executable: process.argv[1] ?? 'unknown',
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    shell: process.env.SHELL ?? process.env.ComSpec ?? 'unknown',
    packageManager: process.env.npm_config_user_agent?.split(' ')[0] || 'unknown',
    osType: os.type(),
    osRelease: os.release(),
    cwd,
    imageOcr: await checkImageOcrAvailability(imageOcrLogoPath),
    configPath: config.path,
    configStoreKeys: Object.keys(config.store),
    project: {
      aiexDir,
      dirExists,
      schemaCount: schemaFiles.length,
      schemaFiles,
      aiConfig,
      aiApiKeySet,
      aiModelCount,
      aiModels,
      aiProvider,
      aiConnectionOk,
      hasDatabase: dbExists,
      migrationCount,
      errors,
    },
  })
}
