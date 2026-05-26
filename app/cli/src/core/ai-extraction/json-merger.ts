import type { JsonSchemaDefinition, JsonSchemaProperty } from '@/core/schema-sqlite/schemas'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stableKey(value: unknown): string {
  if (!isRecord(value)) {
    return JSON.stringify(value)
  }

  return JSON.stringify(Object.keys(value).sort().reduce<Record<string, unknown>>((acc, key) => {
    acc[key] = value[key]
    return acc
  }, {}))
}

function isBlankString(value: unknown): boolean {
  return typeof value === 'string' && value.trim() === ''
}

function isPlaceholderString(value: unknown): boolean {
  if (typeof value !== 'string')
    return false

  const normalized = value.trim().toLowerCase()
  return normalized === ''
    || normalized === 'n/a'
    || normalized === 'na'
    || normalized === 'none'
    || normalized === 'null'
    || normalized === 'unknown'
    || normalized === 'tbd'
    || normalized === '-'
    || normalized === '--'
}

function pickPrimitiveValue(values: unknown[]): unknown {
  const meaningful = values.filter(v => !isBlankString(v) && !isPlaceholderString(v))
  if (meaningful.length === 0)
    return null

  if (typeof meaningful[0] === 'boolean') {
    const trueCount = meaningful.filter(Boolean).length
    const falseCount = meaningful.length - trueCount
    return trueCount >= falseCount
  }

  return meaningful[0]
}

function mergePropertyValue(
  property: JsonSchemaProperty,
  values: any[],
): any {
  // Filter out null and undefined values
  const nonNullValues = values.filter(v => v !== null && v !== undefined)
  if (nonNullValues.length === 0) {
    return null
  }

  if (property.type === 'array') {
    // Concatenate and deduplicate all elements of the arrays.
    const concatenated: any[] = []
    const seen = new Set<string>()
    for (const val of nonNullValues) {
      if (Array.isArray(val)) {
        for (const item of val) {
          const key = stableKey(item)
          if (!seen.has(key)) {
            seen.add(key)
            concatenated.push(item)
          }
        }
      }
    }
    return concatenated
  }

  if (property.type === 'object') {
    // If it's an object, we recursively merge its properties
    const childProperties = property.properties
    if (!childProperties) {
      // If it doesn't specify properties (free-form object), merge keys
      const mergedObj: Record<string, any> = {}
      for (const val of nonNullValues) {
        if (isRecord(val)) {
          Object.assign(mergedObj, val)
        }
      }
      return mergedObj
    }

    const mergedObj: Record<string, any> = {}
    for (const [propName, propDef] of Object.entries(childProperties)) {
      const childValues = nonNullValues.map(v => isRecord(v) ? v[propName] : undefined)
      mergedObj[propName] = mergePropertyValue(propDef, childValues)
    }
    return mergedObj
  }

  // Primitive values (string, integer, number, boolean)
  return pickPrimitiveValue(nonNullValues)
}

/**
 * Merges structured extraction outputs from multiple document chunks
 * according to the schema properties.
 */
export function mergeExtractionResults(
  schema: JsonSchemaDefinition,
  results: Record<string, any>[],
): Record<string, any> {
  if (results.length === 0) {
    return {}
  }
  if (results.length === 1) {
    return results[0]
  }

  const merged: Record<string, any> = {}
  for (const [propName, propDef] of Object.entries(schema.properties)) {
    // Skip auto-increment primary keys if they exist in schema properties
    if (propDef.primary && propDef.autoIncrement) {
      continue
    }
    const values = results.map(r => r[propName])
    merged[propName] = mergePropertyValue(propDef, values)
  }

  return merged
}
