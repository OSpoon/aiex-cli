import type { JsonSchemaDefinition, JsonSchemaProperty } from '@/core/schema-sqlite/schemas'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
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
    // Concatenate all elements of the arrays
    const concatenated: any[] = []
    for (const val of nonNullValues) {
      if (Array.isArray(val)) {
        concatenated.push(...val)
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
  // We prefer the first non-empty, non-null value.
  const bestValue = nonNullValues.find((v) => {
    if (typeof v === 'string') {
      return v.trim() !== ''
    }
    return true
  })

  return bestValue !== undefined ? bestValue : null
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
