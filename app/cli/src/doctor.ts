import type { DoctorDiagnostics } from '@/core/doctor'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { createConfig } from '@/config'
import { readAIConfig } from '@/core/ai-extraction/config'
import { buildDoctorDiagnostics } from '@/core/doctor'
import { createMigrationConfig } from '@/core/schema-sqlite'
import pkg from '~/package.json'

const V1_SUFFIX_RE = /\/v1\/?$/

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

export async function collectDoctorDiagnostics(
  options: CollectDoctorDiagnosticsOptions = {},
): Promise<DoctorDiagnostics> {
  const config = options.config ?? createConfig()
  const cwd = process.cwd()
  const errors: string[] = []

  // Project diagnostics
  const migConfig = createMigrationConfig(cwd)
  const aiexDir = path.dirname(migConfig.schemaPath)
  const dirExists = await fs.stat(aiexDir).then(s => s.isDirectory()).catch(() => false)

  // Schema files
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

  // AI config
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

  // Database
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

  // Migrations
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
