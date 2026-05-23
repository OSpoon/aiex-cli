import type { PromptConfig } from './types'
import type { JsonSchemaDefinition } from '@/core/schema-sqlite/schemas'
import fs from 'node:fs/promises'
import path from 'node:path'
import { readAIConfig } from './config'
import { generatePromptSnapshot } from './prompt-generator'
import { DEFAULT_PROMPT_CONFIG } from './types'

export interface PromptSnapshot {
  system: string
  user: string
}

const SYSTEM_PROMPT_REGEX = /## System Prompt\n([\s\S]*?)(?=## User Prompt|$)/
const USER_PROMPT_REGEX = /## User Prompt Template\n([\s\S]*)$/

export async function loadPromptSnapshot(aiexDir: string, tableName: string): Promise<PromptSnapshot | null> {
  const snapshotPath = path.join(aiexDir, 'extracted', `${tableName}.prompt.md`)

  try {
    const content = await fs.readFile(snapshotPath, 'utf-8')

    const systemMatch = content.match(SYSTEM_PROMPT_REGEX)
    const userMatch = content.match(USER_PROMPT_REGEX)

    if (systemMatch && userMatch) {
      return {
        system: systemMatch[1].trim(),
        user: userMatch[1].trim(),
      }
    }
  }
  catch {
  }

  return null
}

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
