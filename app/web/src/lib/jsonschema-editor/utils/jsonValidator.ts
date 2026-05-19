import type { JSONSchema } from '@/lib/jsonschema-editor/types/jsonSchema.ts'
import Ajv from 'ajv'
import addFormats from 'ajv-formats'
import { parse as parseJsonWithSourceMap } from 'json-source-map'

const POSITION_PATTERN = /position (\d+)/

// Initialize Ajv with all supported formats and meta-schemas
const ajv = new Ajv({
  allErrors: true,
  strict: false,
  validateSchema: false,
  validateFormats: false,
})
addFormats(ajv)

export interface ValidationError {
  path: string
  message: string
  line?: number
  column?: number
}

export interface ValidationResult {
  valid: boolean
  errors?: ValidationError[]
}

/**
 * Finds the line and column number for a specific path in a JSON string
 */
export function findLineNumberForPath(
  jsonStr: string,
  path: string,
): { line: number, column: number } | undefined {
  try {
    if (path === '/' || path === '') {
      return { line: 1, column: 1 }
    }

    const parsed = parseJsonWithSourceMap(jsonStr)
    const pointer = parsed.pointers[path]
    const location = pointer?.key ?? pointer?.value
    return location
      ? { line: location.line + 1, column: location.column + 1 }
      : undefined
  }
  catch (error) {
    console.error('Error finding line number:', error)
    return undefined
  }
}

/**
 * Extracts line and column information from a JSON syntax error message
 */
export function extractErrorPosition(
  error: Error,
  jsonInput: string,
): { line: number, column: number } {
  let line = 1
  let column = 1
  const errorMessage = error.message

  const positionMatch = errorMessage.match(POSITION_PATTERN)
  if (positionMatch?.[1]) {
    const position = Number.parseInt(positionMatch[1], 10)
    const jsonUpToError = jsonInput.substring(0, position)
    const lines = jsonUpToError.split('\n')
    line = lines.length
    column = lines[lines.length - 1].length + 1
  }

  return { line, column }
}

/**
 * Validates a JSON string against a schema and returns validation results
 */
export function validateJson(
  jsonInput: string,
  schema: JSONSchema,
): ValidationResult {
  if (!jsonInput.trim()) {
    return {
      valid: false,
      errors: [
        {
          path: '/',
          message: 'Empty JSON input',
        },
      ],
    }
  }

  try {
    // Parse the JSON input
    const { data: jsonObject } = parseJsonWithSourceMap(jsonInput)

    // Use Ajv to validate the JSON against the schema
    const validate = ajv.compile(schema)
    const valid = validate(jsonObject)

    if (!valid) {
      const errors
        = validate.errors?.map((error) => {
          const path = error.instancePath || '/'
          const position = findLineNumberForPath(jsonInput, path)
          return {
            path,
            message: error.message || 'Unknown error',
            line: position?.line,
            column: position?.column,
          }
        }) || []

      return {
        valid: false,
        errors,
      }
    }

    return {
      valid: true,
      errors: [],
    }
  }
  catch (error) {
    if (!(error instanceof Error)) {
      return {
        valid: false,
        errors: [
          {
            path: '/',
            message: `Unknown error: ${error}`,
          },
        ],
      }
    }

    const { line, column } = extractErrorPosition(error, jsonInput)

    return {
      valid: false,
      errors: [
        {
          path: '/',
          message: error.message,
          line,
          column,
        },
      ],
    }
  }
}
