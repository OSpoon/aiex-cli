const TOP_LEVEL_KEYS = new Set([
  '$schema',
  'title',
  'description',
  'type',
  'table',
  'properties',
  'required',
  'examples',
])

const PROPERTY_KEYS = new Set([
  'description',
  'type',
  'format',
  'pattern',
  'enum',
  'primary',
  'autoIncrement',
  'unique',
  'default',
  'maxLength',
  'minLength',
  'minimum',
  'maximum',
  'examples',
  'xPrompt',
  'drizzle',
  'nested',
  'foreignKey',
  'properties',
  'items',
  'required',
])

const DRIZZLE_KEYS = new Set(['mode'])
const NESTED_KEYS = new Set(['enabled', 'relation'])
const FOREIGN_KEY_KEYS = new Set(['table', 'column'])
const TABLE_KEYS = new Set(['name', 'timestamps', 'softDelete'])

const UNSUPPORTED_JSON_SCHEMA_KEYWORDS = new Set([
  'oneOf',
  'anyOf',
  'allOf',
  'not',
  'if',
  'then',
  'else',
  'const',
  'contains',
  'prefixItems',
  'additionalItems',
  'additionalProperties',
  'patternProperties',
  'propertyNames',
  'dependentRequired',
  'dependentSchemas',
  'dependencies',
  'unevaluatedItems',
  'unevaluatedProperties',
  'multipleOf',
  'exclusiveMinimum',
  'exclusiveMaximum',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function warnUnsupportedKey(warnings: string[], path: string, key: string): void {
  const reason = UNSUPPORTED_JSON_SCHEMA_KEYWORDS.has(key)
    ? 'is not part of the AIEX Drizzle-backed schema dialect and cannot be mapped reliably'
    : 'is not recognized by the AIEX Drizzle-backed schema dialect'
  warnings.push(`${path}.${key} ${reason}.`)
}

function inspectRecordKeys(
  warnings: string[],
  value: unknown,
  path: string,
  allowedKeys: Set<string>,
): void {
  if (!isRecord(value))
    return

  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key))
      warnUnsupportedKey(warnings, path, key)
  }
}

function inspectProperty(
  warnings: string[],
  property: unknown,
  path: string,
): void {
  if (!isRecord(property))
    return

  inspectRecordKeys(warnings, property, path, PROPERTY_KEYS)
  inspectRecordKeys(warnings, property.drizzle, `${path}.drizzle`, DRIZZLE_KEYS)
  inspectRecordKeys(warnings, property.nested, `${path}.nested`, NESTED_KEYS)
  inspectRecordKeys(warnings, property.foreignKey, `${path}.foreignKey`, FOREIGN_KEY_KEYS)

  if (isRecord(property.properties)) {
    for (const [name, child] of Object.entries(property.properties))
      inspectProperty(warnings, child, `${path}.properties.${name}`)
  }

  if (property.items)
    inspectProperty(warnings, property.items, `${path}.items`)
}

export function collectDialectWarnings(schema: unknown, filePath: string): string[] {
  if (!isRecord(schema))
    return []

  const warnings: string[] = []
  inspectRecordKeys(warnings, schema, filePath, TOP_LEVEL_KEYS)
  inspectRecordKeys(warnings, schema.table, `${filePath}.table`, TABLE_KEYS)

  if (isRecord(schema.properties)) {
    for (const [name, property] of Object.entries(schema.properties))
      inspectProperty(warnings, property, `${filePath}.properties.${name}`)
  }

  return warnings
}
