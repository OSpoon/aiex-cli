import type { JsonSchemaDefinition, JsonSchemaProperty } from '@/core/schema-sqlite/schemas'

function nullableType(type: string): string[] {
  return type === 'null' ? ['null'] : [type, 'null']
}

function propertyToExtractionSchema(property: JsonSchemaProperty): Record<string, unknown> {
  if (property.type === 'array') {
    return {
      type: nullableType('array'),
      items: property.items ? propertyToExtractionSchema(property.items) : {},
    }
  }

  if (property.type === 'object') {
    const childProperties = property.properties
      ? Object.fromEntries(
          Object.entries(property.properties).map(([name, prop]) => [name, propertyToExtractionSchema(prop)]),
        )
      : undefined

    return {
      type: nullableType('object'),
      ...(childProperties
        ? {
            properties: childProperties,
            required: Object.keys(childProperties),
            additionalProperties: false,
          }
        : { additionalProperties: true }),
    }
  }

  return {
    type: nullableType(property.type),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function schemaToExtractionOutputSchema(schema: JsonSchemaDefinition): Record<string, unknown> {
  const properties = Object.fromEntries(
    Object.entries(schema.properties)
      .filter(([, prop]) => !(prop.primary && prop.autoIncrement))
      .map(([name, prop]) => [name, propertyToExtractionSchema(prop)]),
  )

  return {
    type: 'object',
    additionalProperties: false,
    properties,
    required: Object.keys(properties),
  }
}

function validatePropertyValue(path: string, property: JsonSchemaProperty, value: unknown, issues: string[]): void {
  if (value === null)
    return

  switch (property.type) {
    case 'string':
      if (typeof value !== 'string')
        issues.push(`${path}: expected string or null`)
      return
    case 'integer':
      if (!Number.isInteger(value))
        issues.push(`${path}: expected integer or null`)
      return
    case 'number':
      if (typeof value !== 'number' || Number.isNaN(value))
        issues.push(`${path}: expected number or null`)
      return
    case 'boolean':
      if (typeof value !== 'boolean')
        issues.push(`${path}: expected boolean or null`)
      return
    case 'array':
      if (!Array.isArray(value)) {
        issues.push(`${path}: expected array or null`)
        return
      }
      if (property.items) {
        const itemProperty = property.items
        value.forEach((item, index) => validatePropertyValue(`${path}[${index}]`, itemProperty, item, issues))
      }
      return
    case 'object': {
      if (!isRecord(value)) {
        issues.push(`${path}: expected object or null`)
        return
      }
      if (property.properties)
        validateProperties(path, property.properties, value, issues)
      return
    }
    case 'null':
      issues.push(`${path}: expected null`)
  }
}

function validateProperties(
  basePath: string,
  properties: Record<string, JsonSchemaProperty>,
  data: Record<string, unknown>,
  issues: string[],
): void {
  const expected = Object.entries(properties)
    .filter(([, prop]) => !(prop.primary && prop.autoIncrement))

  const expectedKeys = new Set(expected.map(([name]) => name))
  for (const key of Object.keys(data)) {
    if (!expectedKeys.has(key))
      issues.push(`${basePath}.${key}: unexpected field`)
  }

  for (const [name, prop] of expected) {
    const path = `${basePath}.${name}`
    if (!(name in data)) {
      issues.push(`${path}: missing field`)
      continue
    }
    validatePropertyValue(path, prop, data[name], issues)
  }
}

export function validateExtractedData(
  schema: JsonSchemaDefinition,
  data: unknown,
): { success: true } | { success: false, error: string } {
  if (!isRecord(data)) {
    return { success: false, error: 'Extracted data must be a JSON object.' }
  }

  const issues: string[] = []
  validateProperties('$', schema.properties, data, issues)
  if (issues.length > 0) {
    return {
      success: false,
      error: `Extracted data does not match schema:\n${issues.map(issue => `  - ${issue}`).join('\n')}`,
    }
  }

  return { success: true }
}
