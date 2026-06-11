import type { JSONSchema } from "@/lib/jsonschema-editor/types/jsonSchema.ts"
import { cloneJson } from "@/lib/jsonschema-editor/lib/object-utils"

const CAMEL_CASE_BOUNDARY_RE = /([a-z0-9])([A-Z])/g
const NON_ALPHANUMERIC_RE = /[^a-z0-9]+/gi
const EDGE_UNDERSCORE_RE = /^_+|_+$/g
const REPEATED_UNDERSCORE_RE = /_+/g
const LEADING_NON_ALPHA_RE = /^[^a-z]+/

function isObjectSchemaLike(schema: JSONSchema): schema is Exclude<JSONSchema, boolean> {
  return typeof schema === "object" && schema !== null && !Array.isArray(schema)
}

export function deriveTableName(input: string): string {
  return input
    .trim()
    .replace(CAMEL_CASE_BOUNDARY_RE, "$1_$2")
    .replace(NON_ALPHANUMERIC_RE, "_")
    .replace(EDGE_UNDERSCORE_RE, "")
    .replace(REPEATED_UNDERSCORE_RE, "_")
    .toLowerCase()
    .replace(LEADING_NON_ALPHA_RE, "")
}

export function normalizeSchemaNaming(schema: JSONSchema): JSONSchema {
  if (!isObjectSchemaLike(schema))
    return schema

  const next = cloneJson(schema)
  const title = next.title?.trim() ?? ""
  next.title = title
  next.table = {
    ...next.table,
    name: deriveTableName(title)
  }
  return next
}
