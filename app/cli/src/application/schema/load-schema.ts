import type { MigrationConfig } from '@/domain/schema/types'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { readFile as readJsonFile } from 'jsonfile'
import { ZodError } from 'zod'
import { JsonSchemaDefinitionSchema } from '@/domain/schema/schemas'
import { t } from '@/locales'

const JSON_EXT_RE = /\.json$/

export async function loadSchema(config: MigrationConfig, schemaName: string): Promise<{ schema: any, error?: string }> {
  const schemaPath = path.join(config.schemaPath, `${schemaName}.json`)
  try {
    const parsed = await readJsonFile(schemaPath)
    const validated = JsonSchemaDefinitionSchema.parse(parsed)
    return { schema: validated }
  }
  catch (e) {
    if (e instanceof ZodError) {
      return { schema: null, error: t('errors.schema.validationFailed', { name: `${schemaName}.json`, issues: e.issues.map(i => `  - ${i.path.join('.')}: ${i.message}`).join('\n') }) }
    }
    const nodeError = e as NodeJS.ErrnoException
    if (nodeError.code === 'ENOENT') {
      return { schema: null, error: t('errors.schema.cannotRead', { name: `${schemaName}.json` }) }
    }
    if (e instanceof SyntaxError) {
      return { schema: null, error: t('errors.schema.invalidJson', { name: `${schemaName}.json` }) }
    }
    return { schema: null, error: String(e) }
  }
}

export async function listSchemas(aiexDir: string): Promise<string[]> {
  try {
    const dir = path.join(aiexDir, 'schema')
    const entries = await fsp.readdir(dir)
    return entries
      .filter(f => f.endsWith('.json'))
      .map(f => f.replace(JSON_EXT_RE, ''))
      .sort()
  }
  catch {
    return []
  }
}
