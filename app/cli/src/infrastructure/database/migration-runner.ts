import type { MigrationResult } from '@/application/schema/schema-sync'
import type { MigrationConfig } from '@/domain/schema/types'
import { execFile } from 'node:child_process'
import process from 'node:process'
import { promisify } from 'node:util'
import { resolveHelperPath, resolveTsxPath } from '@/infrastructure/runtime/package-paths'
import { t } from '@/locales'

const execFileAsync = promisify(execFile)

export function parseMigrationOutput(stdout: string, stderr: string): MigrationResult {
  try {
    const lines = stdout.trim().split('\n')
    const jsonLine = lines.find(l => l.startsWith('{') && l.endsWith('}'))
    if (!jsonLine)
      return { success: false, error: t('errors.schema.migrationHelperInvalidOutput') }

    const result = JSON.parse(jsonLine) as MigrationResult
    if (!result.success)
      return { success: false, error: result.error || t('errors.schema.migrationFailed') }
    return result
  }
  catch {
    return { success: false, error: stderr || stdout || t('errors.schema.migrationHelperFailed') }
  }
}

export async function runDatabaseMigration(
  config: MigrationConfig,
  migrationName?: string,
): Promise<MigrationResult> {
  const helperPath = resolveHelperPath()
  const tsxPath = resolveTsxPath()
  const helperArgs = [tsxPath, helperPath, config.drizzleSchemaPath, config.migrationsPath, config.databasePath]
  if (migrationName)
    helperArgs.push(migrationName)

  try {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      helperArgs,
      { cwd: process.cwd() },
    )

    return parseMigrationOutput(stdout, stderr)
  }
  catch (error: unknown) {
    const execError = error as { stderr?: string, stdout?: string, message?: string }
    return {
      success: false,
      error: execError.stderr || execError.stdout || execError.message || String(error),
    }
  }
}
