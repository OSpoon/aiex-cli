import type { JsonSchemaDefinition } from '@/domain/schema/schemas'

export function expectedExtractionFields(schema: JsonSchemaDefinition): string[] {
  return Object.entries(schema.properties)
    .filter(([, prop]) => !(prop.primary && prop.autoIncrement))
    .map(([name]) => name)
}

export function calculateMissingFields(schema: JsonSchemaDefinition, data: unknown): { fields: string[], rate: number } {
  const expected = expectedExtractionFields(schema)
  if (expected.length === 0)
    return { fields: [], rate: 0 }
  if (!data || typeof data !== 'object' || Array.isArray(data))
    return { fields: expected, rate: 1 }

  const record = data as Record<string, unknown>
  const fields = expected.filter((field) => {
    const value = record[field]
    return value === undefined || value === null || value === ''
  })
  return { fields, rate: fields.length / expected.length }
}
