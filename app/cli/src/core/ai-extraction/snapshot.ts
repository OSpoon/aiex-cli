import type { PromptConfig } from './types'
import type { JsonSchemaDefinition } from '@/core/schema-sqlite/schemas'
import fs from 'node:fs/promises'
import path from 'node:path'
import { readAIConfig } from './config'
import { generatePromptSnapshot } from './prompt-generator'
import { DEFAULT_PROMPT_CONFIG } from './types'

export async function savePromptSnapshot(
  schema: JsonSchemaDefinition,
  aiexDir: string,
): Promise<string> {
  // Read AI config for prompt templates
  const aiConfig = await readAIConfig(aiexDir)
  const promptConfig: PromptConfig = aiConfig?.prompt ?? DEFAULT_PROMPT_CONFIG

  // Generate snapshot content
  const content = generatePromptSnapshot(schema, promptConfig)

  // Ensure output directory exists
  const outputDir = path.join(aiexDir, 'extracted')
  await fs.mkdir(outputDir, { recursive: true })

  // Save snapshot file
  const fileName = `${schema.table.name}.prompt.md`
  const outputPath = path.join(outputDir, fileName)
  await fs.writeFile(outputPath, content)

  return outputPath
}
