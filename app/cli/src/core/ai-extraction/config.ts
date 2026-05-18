import type { AIConfig } from './types'
import fs from 'node:fs/promises'
import path from 'node:path'
import { AIConfigSchema } from './schemas'
import { DEFAULT_AI_CONFIG } from './types'

const CONFIG_FILE_NAME = 'ai-config.json'
const GITIGNORE_FILE = '.gitignore'

export async function readAIConfig(aiexDir: string): Promise<AIConfig | null> {
  const configPath = path.join(aiexDir, CONFIG_FILE_NAME)

  try {
    const content = await fs.readFile(configPath, 'utf-8')
    const parsed = JSON.parse(content)
    const validated = AIConfigSchema.parse(parsed)
    return validated
  }
  catch {
    return null
  }
}

export async function writeAIConfig(aiexDir: string, config: AIConfig): Promise<void> {
  const configPath = path.join(aiexDir, CONFIG_FILE_NAME)

  // Ensure aiex directory exists
  await fs.mkdir(aiexDir, { recursive: true })

  // Write config file
  await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`)

  // Ensure ai-config.json is in .gitignore (for API key security)
  await addToGitignore(aiexDir, CONFIG_FILE_NAME)
}

export function getDefaultAIConfig(): AIConfig {
  return { ...DEFAULT_AI_CONFIG }
}

export function maskApiKey(apiKey: string): string {
  return apiKey
}

async function addToGitignore(aiexDir: string, fileName: string): Promise<void> {
  // Find .gitignore in the project root (parent of .aiex)
  const projectRoot = path.dirname(aiexDir)
  const gitignorePath = path.join(projectRoot, GITIGNORE_FILE)

  try {
    const content = await fs.readFile(gitignorePath, 'utf-8')
    const lines = content.split('\n')

    // Check if ai-config.json is already in gitignore
    if (lines.some(line => line.trim() === fileName || line.includes('.aiex/'))) {
      return
    }

    // Add to gitignore
    const newContent = content.endsWith('\n')
      ? `${content}${fileName}\n`
      : `${content}\n${fileName}\n`
    await fs.writeFile(gitignorePath, newContent)
  }
  catch {
    // .gitignore doesn't exist, create it
    await fs.writeFile(gitignorePath, `${fileName}\n`)
  }
}
