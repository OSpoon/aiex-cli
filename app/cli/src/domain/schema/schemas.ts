import { z } from 'zod'

export const DrizzleModeSchema = z.enum(['json', 'timestamp', 'timestamp_ms', 'boolean', 'bigint'])

export const DrizzleExtensionSchema = z.object({
  mode: DrizzleModeSchema.optional(),
  customType: z.string().optional(),
}).optional()

export const NestedConfigSchema = z.object({
  enabled: z.literal(true),
  relation: z.enum(['has-one', 'has-many']),
})

export const ForeignKeyRefSchema = z.object({
  table: z.string().min(1),
  column: z.string().min(1),
})

export const JsonSchemaPropertySchema: z.ZodType<JsonSchemaProperty> = z.lazy(() => z.object({
  description: z.string().optional(),
  type: z.enum(['string', 'integer', 'number', 'boolean', 'object', 'array', 'null']),
  format: z.string().optional(),
  pattern: z.string().optional(),
  enum: z.array(z.union([z.string(), z.number()])).optional(),
  primary: z.boolean().optional(),
  autoIncrement: z.boolean().optional(),
  unique: z.boolean().optional(),
  default: z.unknown().optional(),
  maxLength: z.number().int().positive().optional(),
  minLength: z.number().int().nonnegative().optional(),
  minimum: z.number().optional(),
  maximum: z.number().optional(),
  examples: z.array(z.unknown()).optional(),
  xPrompt: z.string().optional(),
  drizzle: DrizzleExtensionSchema,
  nested: NestedConfigSchema.optional(),
  foreignKey: ForeignKeyRefSchema.optional(),
  properties: z.record(z.string(), JsonSchemaPropertySchema).optional(),
  items: JsonSchemaPropertySchema.optional(),
  required: z.array(z.string()).optional(),
}))

export const TableConfigSchema = z.object({
  name: z.string().min(1).regex(/^[a-z][a-z0-9_]*$/, 'Table name must be snake_case (lowercase letters, digits, underscores)'),
  timestamps: z.boolean().optional(),
  softDelete: z.boolean().optional(),
})

export const ExamplePairSchema = z.object({
  text: z.string().min(1),
  output: z.record(z.string(), z.unknown()),
})

export const JsonSchemaDefinitionSchema = z.object({
  $schema: z.string().optional(),
  title: z.string().min(1),
  description: z.string().optional(),
  type: z.literal('object'),
  table: TableConfigSchema,
  properties: z.record(z.string(), JsonSchemaPropertySchema),
  required: z.array(z.string()).optional(),
  examples: z.array(ExamplePairSchema).optional(),
}).refine(
  schema => Object.keys(schema.properties).length >= 1,
  { message: 'At least one property is required', path: ['properties'] },
).refine(
  schema => !schema.required || schema.required.every(r => r in schema.properties),
  { message: 'All required fields must be defined in properties', path: ['required'] },
).refine(
  (schema) => {
    const hasPrimary = Object.values(schema.properties).some(p => p.primary)
    return !hasPrimary || Object.values(schema.properties).filter(p => p.primary).length === 1
  },
  { message: 'Only one primary key is allowed per table', path: ['properties'] },
)

export interface ForeignKeyRef {
  table: string
  column: string
}

export interface JsonSchemaProperty {
  description?: string
  type: 'string' | 'integer' | 'number' | 'boolean' | 'object' | 'array' | 'null'
  format?: string
  pattern?: string
  enum?: (string | number)[]
  primary?: boolean
  autoIncrement?: boolean
  unique?: boolean
  default?: unknown
  maxLength?: number
  minLength?: number
  minimum?: number
  maximum?: number
  examples?: unknown[]
  xPrompt?: string
  drizzle?: { mode?: 'json' | 'timestamp' | 'timestamp_ms' | 'boolean' | 'bigint', customType?: string }
  nested?: { enabled: true, relation: 'has-one' | 'has-many' }
  foreignKey?: ForeignKeyRef
  properties?: Record<string, JsonSchemaProperty>
  items?: JsonSchemaProperty
  required?: string[]
}

export type JsonSchemaDefinition = z.infer<typeof JsonSchemaDefinitionSchema>
