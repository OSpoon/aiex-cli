export const EVIDENCE_INSTRUCTIONS = `Evidence requirements:
- Also return a top-level "_evidence" object.
- For each top-level scalar field you extracted from the text, include "_evidence.<field>.quote".
- The quote must be an exact contiguous substring copied from the input text.
- Do not invent offsets. Only provide quotes.
- If no exact quote supports a field, omit that field from "_evidence".`

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
