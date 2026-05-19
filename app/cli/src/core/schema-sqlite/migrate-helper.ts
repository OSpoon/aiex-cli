import type { DrizzleSQLiteSnapshotJSON } from 'drizzle-kit/api'
import fs from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import * as esbuild from 'esbuild'
import lockfile from 'proper-lockfile'
import { sanitizeMigrationName } from './migration-name'

const require = createRequire(import.meta.url)
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const { generateSQLiteDrizzleJson, generateSQLiteMigration } = require('drizzle-kit/api') as typeof import('drizzle-kit/api')

const EMPTY_SNAPSHOT: DrizzleSQLiteSnapshotJSON = {
  version: '6',
  dialect: 'sqlite',
  tables: {},
  views: {},
  enums: {},
  _meta: { tables: {}, columns: {} },
  internal: { indexes: {} },
  id: '00000000-0000-0000-0000-000000000000',
  prevId: '00000000-0000-0000-0000-000000000000',
}

async function loadSchemaExports(schemaPath: string): Promise<Record<string, unknown>> {
  // Find the CLI package root for module resolution
  let cliDir: string
  try {
    const pkgPath = require.resolve('aiex-cli/package.json')
    cliDir = path.dirname(pkgPath)
  }
  catch {
    cliDir = path.dirname(path.dirname(path.dirname(path.dirname(__dirname))))
  }

  // Bundle the schema with esbuild, resolving drizzle-orm from CLI's node_modules
  const result = await esbuild.build({
    entryPoints: [schemaPath],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    write: false,
    nodePaths: [path.join(cliDir, 'node_modules')],
  })

  const tempPath = schemaPath.replace('.ts', '.__bundled__.cjs')
  await fs.writeFile(tempPath, result.outputFiles[0].text)

  try {
    const exports = require(tempPath) as Record<string, unknown>
    await fs.unlink(tempPath)
    return exports
  }
  catch (e) {
    await fs.unlink(tempPath).catch(() => {})
    throw e
  }
}

async function loadPrevSnapshot(migrationsPath: string): Promise<DrizzleSQLiteSnapshotJSON | null> {
  const metaPath = path.join(migrationsPath, 'meta', '_journal.json')

  try {
    const journal = JSON.parse(await fs.readFile(metaPath, 'utf-8'))
    if (!journal.entries?.length)
      return null

    const latestEntry = journal.entries[journal.entries.length - 1]
    const snapshotPath = path.join(migrationsPath, 'meta', `${latestEntry.tag}_snapshot.json`)

    return JSON.parse(await fs.readFile(snapshotPath, 'utf-8'))
  }
  catch {
    return null
  }
}

async function saveSnapshot(
  migrationsPath: string,
  snapshot: DrizzleSQLiteSnapshotJSON,
  migrationName?: string,
): Promise<string> {
  const metaPath = path.join(migrationsPath, 'meta')
  await fs.mkdir(metaPath, { recursive: true })

  const journalPath = path.join(metaPath, '_journal.json')
  let journal: { version: string, dialect: string, entries: Array<{ idx: number, version: string, when: number, tag: string, breakpoints: boolean }> }

  try {
    journal = JSON.parse(await fs.readFile(journalPath, 'utf-8'))
  }
  catch {
    journal = { version: '6', dialect: 'sqlite', entries: [] }
  }

  const idx = journal.entries.length + 1
  const suffix = sanitizeMigrationName(migrationName) || snapshot.id.replace(/-/g, '_').substring(0, 8)
  const tag = `${String(idx).padStart(4, '0')}_${suffix}`

  const snapshotPath = path.join(metaPath, `${tag}_snapshot.json`)
  await fs.writeFile(snapshotPath, JSON.stringify(snapshot, null, 2))

  journal.entries.push({
    idx,
    version: snapshot.id,
    when: Date.now(),
    tag,
    breakpoints: true,
  })
  await fs.writeFile(journalPath, JSON.stringify(journal, null, 2))

  return tag
}

async function saveMigrationFile(
  migrationsPath: string,
  tag: string,
  sqlStatements: string[],
): Promise<string> {
  await fs.mkdir(migrationsPath, { recursive: true })

  const sqlPath = path.join(migrationsPath, `${tag}.sql`)
  const sqlContent = sqlStatements.join('\n--> statement-breakpoint\n')

  await fs.writeFile(sqlPath, sqlContent)
  return sqlPath
}

function applyMigrationWithTransaction(dbPath: string, sqlStatements: string[]): void {
  const db = new Database(dbPath)

  // Use transaction to ensure atomicity
  const transaction = db.transaction(() => {
    for (const sql of sqlStatements) {
      db.exec(sql)
    }
  })

  try {
    transaction()
  }
  finally {
    db.close()
  }
}

const LOCK_FILE = '.migrate.lock'

async function acquireMigrationLock(aiexDir: string): Promise<() => Promise<void>> {
  await fs.mkdir(aiexDir, { recursive: true })

  try {
    return await lockfile.lock(aiexDir, {
      lockfilePath: path.join(aiexDir, LOCK_FILE),
      realpath: false,
      stale: 300000,
      update: 10000,
      retries: 0,
    })
  }
  catch (error) {
    const lockPath = path.join(aiexDir, LOCK_FILE)
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Migration is already running or the lock could not be acquired. Wait for it to complete or remove ${lockPath} if stale. ${message}`)
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const schemaPath = args[0]
  const migrationsPath = args[1]
  const dbPath = args[2]
  const migrationName = args[3]

  if (!schemaPath || !migrationsPath || !dbPath) {
    console.error('Usage: migrate-helper.ts <schemaPath> <migrationsPath> <dbPath> [migrationName]')
    process.exit(1)
  }

  try {
    // Acquire lock to prevent concurrent migrations
    const aiexDir = path.dirname(path.dirname(migrationsPath))
    const releaseLock = await acquireMigrationLock(aiexDir)

    try {
      const exports = await loadSchemaExports(schemaPath)

      // Check if database file exists — if missing, force full migration
      let dbMissing = false
      try {
        await fs.access(dbPath)
      }
      catch {
        dbMissing = true
      }

      const prevSnapshot = dbMissing ? null : await loadPrevSnapshot(migrationsPath)
      const currentSnapshot = await generateSQLiteDrizzleJson(exports, prevSnapshot?.id)

      const prev = prevSnapshot || EMPTY_SNAPSHOT
      const sqlStatements = await generateSQLiteMigration(prev, currentSnapshot)

      if (sqlStatements.length === 0) {
        // eslint-disable-next-line no-console
        console.log(JSON.stringify({ success: true, changes: 0 }))
        return
      }

      // Execute SQL in transaction FIRST
      // If this fails, database is unchanged and we don't save snapshot
      applyMigrationWithTransaction(dbPath, sqlStatements)

      // Only save snapshot and migration file AFTER successful DB update
      const tag = await saveSnapshot(migrationsPath, currentSnapshot, migrationName)
      await saveMigrationFile(migrationsPath, tag, sqlStatements)

      // eslint-disable-next-line no-console
      console.log(JSON.stringify({ success: true, changes: sqlStatements.length, tag }))
    }
    finally {
      await releaseLock()
    }
  }
  catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(JSON.stringify({ success: false, error: message }))
    process.exit(1)
  }
}

if (process.argv[1] && __filename === path.resolve(process.argv[1]))
  main()
