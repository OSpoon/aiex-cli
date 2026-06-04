export { EVIDENCE_INSTRUCTIONS } from '@/domain/ai/prompts'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function withEvidenceSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const properties = isRecord(schema.properties) ? schema.properties : {}
  const required = Array.isArray(schema.required) ? schema.required : []
  return {
    ...schema,
    properties: {
      ...properties,
      _evidence: {
        type: ['object', 'null'],
        additionalProperties: {
          type: 'object',
          additionalProperties: false,
          properties: {
            quote: { type: 'string' },
          },
          required: ['quote'],
        },
      },
    },
    required,
  }
}
