import type { JSONSchema } from '@/lib/jsonschema-editor/types/jsonSchema.ts'
import { cloneJson } from '@/lib/jsonschema-editor/lib/object-utils'

function isObjectSchemaLike(schema: JSONSchema): schema is Exclude<JSONSchema, boolean> {
  return typeof schema === 'object' && schema !== null && !Array.isArray(schema)
}

export function deriveTableName(input: string): string {
  return input
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^a-z0-9]+/gi, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_')
    .toLowerCase()
    .replace(/^[^a-z]+/, '')
}

export function normalizeSchemaNaming(schema: JSONSchema): JSONSchema {
  if (!isObjectSchemaLike(schema))
    return schema

  const next = cloneJson(schema)
  const title = next.title?.trim() ?? ''
  next.title = title
  next.table = {
    ...next.table,
    name: deriveTableName(title),
  }
  return next
}
