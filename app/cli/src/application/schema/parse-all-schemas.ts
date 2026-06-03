import type { ParsedRelation, ParsedReverseRelation, ParsedTable, SchemaMappingEntry } from '@/domain/schema/types'
import { ZodError } from 'zod'
import { collectDialectWarnings } from '@/domain/schema/dialect'
import { parseJsonSchema } from '@/domain/schema/parser'
import { JsonSchemaDefinitionSchema } from '@/domain/schema/schemas'
import { generateDrizzleSchema } from '@/infrastructure/schema/generate-drizzle-schema'

export interface SchemaEntry {
  filePath: string
  content: string
}

export interface ParsedSchemas {
  tables: ParsedTable[]
  relations: ParsedRelation[]
  reverseRelations: ParsedReverseRelation[]
  warnings: string[]
  mapping: SchemaMappingEntry[]
  drizzleCode: string
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
  const mapping: SchemaMappingEntry[] = []

  for (const { filePath, content } of entries) {
    let schema: unknown
    try {
      schema = JSON.parse(content)
    }
    catch {
      return { success: false, error: `Failed to parse JSON in ${filePath}` }
    }

    try {
      warnings.push(...collectDialectWarnings(schema, filePath))
      const validated = JsonSchemaDefinitionSchema.parse(schema)
      const result = parseJsonSchema(validated)
      tables.push(...result.tables)
      relations.push(...result.relations)
      reverseRelations.push(...result.reverseRelations)
      warnings.push(...result.warnings)
      mapping.push(...(result.mapping ?? []).map(entry => ({
        ...entry,
        schemaPath: `${filePath}${entry.schemaPath.slice(1)}`,
      })))
    }
    catch (e) {
      if (e instanceof ZodError) {
        return { success: false, error: formatZodError(e, filePath) }
      }
      throw e
    }
  }

  const drizzleCode = generateDrizzleSchema({ tables, relations, reverseRelations, warnings })
  return { success: true, data: { tables, relations, reverseRelations, warnings, mapping, drizzleCode } }
}
