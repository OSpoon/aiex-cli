import type { ParsedRelation, ParsedReverseRelation, ParsedTable } from './types'
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { ZodError } from 'zod'
import { generateDrizzleSchema } from './generator'
import { parseJsonSchema } from './parser'
import { JsonSchemaDefinitionSchema } from './schemas'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const require = createRequire(__filename)

export interface SchemaEntry {
  filePath: string
  content: string
}

export interface ParsedSchemas {
  tables: ParsedTable[]
  relations: ParsedRelation[]
  reverseRelations: ParsedReverseRelation[]
  warnings: string[]
  drizzleCode: string
}

export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function resolvePackageRoot(): string {
  const pkgPath = require.resolve('aiex-cli/package.json')
  return path.dirname(pkgPath)
}

export function resolveTsxPath(): string {
  try {
    return require.resolve('tsx/cli', { paths: [process.cwd()] })
  }
  catch {
    return require.resolve('tsx/cli')
  }
}

export function resolveHelperPath(): string {
  try {
    return path.join(resolvePackageRoot(), 'src/core/schema-sqlite/migrate-helper.ts')
  }
  catch {
    return path.join(__dirname, 'migrate-helper.ts')
  }
}

export function formatZodError(error: ZodError, filePath: string): string {
  const issues = error.issues.map(issue => `  - ${issue.path.join('.')}: ${issue.message}`)
  return `${filePath}:\n${issues.join('\n')}`
}

export function parseAllSchemas(entries: SchemaEntry[]): { success: true, data: ParsedSchemas } | { success: false, error: string } {
  const tables: ParsedTable[] = []
  const relations: ParsedRelation[] = []
  const reverseRelations: ParsedReverseRelation[] = []
  const warnings: string[] = []

  for (const { filePath, content } of entries) {
    let schema: unknown
    try {
      schema = JSON.parse(content)
    }
    catch {
      return { success: false, error: `Failed to parse JSON in ${filePath}` }
    }

    try {
      const validated = JsonSchemaDefinitionSchema.parse(schema)
      const result = parseJsonSchema(validated)
      tables.push(...result.tables)
      relations.push(...result.relations)
      reverseRelations.push(...result.reverseRelations)
      warnings.push(...result.warnings)
    }
    catch (e) {
      if (e instanceof ZodError) {
        return { success: false, error: formatZodError(e, filePath) }
      }
      throw e
    }
  }

  const drizzleCode = generateDrizzleSchema({ tables, relations, reverseRelations, warnings })
  return { success: true, data: { tables, relations, reverseRelations, warnings, drizzleCode } }
}
