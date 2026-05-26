import type { JsonSchemaDefinition, JsonSchemaProperty, PromptConfig } from '@/types'
import { DEFAULT_PROMPT_CONFIG, PLACEHOLDER_SCHEMA, PLACEHOLDER_TEXT } from './types'

function propertyToDescription(name: string, prop: JsonSchemaProperty, indent: string = ''): string {
  const lines: string[] = []

  let typeStr: string = prop.type
  if (prop.type === 'array' && prop.items) {
    typeStr = `array of ${prop.items.type}`
  }
  lines.push(`${indent}- ${name}: ${typeStr}`)

  if (prop.minLength !== undefined || prop.maxLength !== undefined) {
    lines.push(`${indent}  length: ${prop.minLength ?? 0} - ${prop.maxLength ?? 'unlimited'}`)
  }

  if (prop.format) {
    lines.push(`${indent}  format: ${prop.format}`)
  }

  if (prop.unique) {
    lines.push(`${indent}  unique: true`)
  }

  if (prop.default !== undefined) {
    lines.push(`${indent}  default: ${JSON.stringify(prop.default)}`)
  }

  return lines.join('\n')
}

function nestedPropertyToDescription(name: string, prop: JsonSchemaProperty, indent: string = ''): string {
  const lines: string[] = []

  // Handle nested object (e.g., address with nested.enabled)
  if (prop.nested?.enabled && prop.type === 'object') {
    const relation = prop.nested.relation || 'has-one'
    lines.push(`${indent}- ${name}: object (related table, ${relation})`)
    if (prop.properties) {
      for (const [childName, childProp] of Object.entries(prop.properties)) {
        lines.push(nestedPropertyToDescription(childName, childProp as JsonSchemaProperty, `${indent}  `))
      }
    }
    return lines.join('\n')
  }

  // Handle nested array (e.g., orders with items.nested.enabled)
  if (prop.type === 'array' && prop.items?.nested?.enabled) {
    const relation = prop.items.nested.relation || 'has-many'
    lines.push(`${indent}- ${name}: array of object (related table, ${relation})`)
    if (prop.items.properties) {
      for (const [childName, childProp] of Object.entries(prop.items.properties)) {
        lines.push(nestedPropertyToDescription(childName, childProp as JsonSchemaProperty, `${indent}  `))
      }
    }
    return lines.join('\n')
  }

  // Non-nested property: basic description
  lines.push(propertyToDescription(name, prop, indent))

  // Non-nested object children
  if (prop.type === 'object' && prop.properties) {
    for (const [childName, childProp] of Object.entries(prop.properties)) {
      lines.push(nestedPropertyToDescription(childName, childProp as JsonSchemaProperty, `${indent}  `))
    }
  }

  // Non-nested array item children
  if (prop.type === 'array' && prop.items?.properties && !prop.items?.nested?.enabled) {
    lines.push(`${indent}  item fields:`)
    for (const [childName, childProp] of Object.entries(prop.items.properties)) {
      lines.push(nestedPropertyToDescription(childName, childProp as JsonSchemaProperty, `${indent}    `))
    }
  }

  return lines.join('\n')
}

export function schemaToDescription(schema: JsonSchemaDefinition): string {
  const lines: string[] = []

  lines.push(`Table: ${schema.table.name}`)

  if (schema.required && schema.required.length > 0) {
    lines.push(`Required: ${schema.required.join(', ')}`)
  }

  lines.push('')
  lines.push('Fields:')

  for (const [name, prop] of Object.entries(schema.properties)) {
    const property = prop as JsonSchemaProperty
    lines.push(nestedPropertyToDescription(name, property))
  }

  if (schema.examples && schema.examples.length > 0) {
    lines.push('')
    lines.push('Examples / Few-shot Cases:')
    schema.examples.forEach((example, idx) => {
      lines.push('')
      lines.push(`Example ${idx + 1}:`)
      lines.push('Input text:')
      lines.push('"""')
      lines.push(example.text)
      lines.push('"""')
      lines.push('Expected JSON output:')
      lines.push('```json')
      lines.push(JSON.stringify(example.output, null, 2))
      lines.push('```')
    })
  }

  return lines.join('\n')
}

export function generateExtractionPrompt(
  schema: JsonSchemaDefinition,
  text: string,
  promptConfig: PromptConfig = DEFAULT_PROMPT_CONFIG,
): { system: string, user: string } {
  const schemaDescription = schemaToDescription(schema)

  const system = promptConfig.systemTemplate.replaceAll(PLACEHOLDER_SCHEMA, schemaDescription)
  const user = promptConfig.userTemplate.replaceAll(PLACEHOLDER_TEXT, text)

  return { system, user }
}

export function generatePromptSnapshot(
  schema: JsonSchemaDefinition,
  promptConfig: PromptConfig = DEFAULT_PROMPT_CONFIG,
): string {
  const { system, user } = generateExtractionPrompt(schema, '{text}', promptConfig)

  const parts: string[] = [
    '# Prompt Snapshot',
    '',
    `Table: ${schema.table.name}`,
    `Generated: ${new Date().toISOString()}`,
    '',
    '## System Prompt',
    '',
    system,
    '',
    '## User Prompt Template',
    '',
    user,
  ]

  return parts.join('\n')
}
