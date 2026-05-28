import type { AIConfig } from '@/domain/ai/types'
import fs from 'node:fs/promises'
import path from 'node:path'
import { readFile as readJsonFile, writeFile as writeJsonFile } from 'jsonfile'
import { AIConfigSchema } from '@/domain/ai/schemas'
import { DEFAULT_AI_CONFIG } from '@/domain/ai/types'

const CONFIG_FILE_NAME = 'ai-config.json'
const GITIGNORE_FILE = '.gitignore'

export async function readAIConfig(aiexDir: string): Promise<AIConfig | null> {
  const configPath = path.join(aiexDir, CONFIG_FILE_NAME)

  try {
    const parsed = await readJsonFile(configPath)
    const validated = AIConfigSchema.parse(parsed)
    return validated
  }
  catch {
    return null
  }
}

export async function writeAIConfig(aiexDir: string, config: AIConfig): Promise<void> {
  const configPath = path.join(aiexDir, CONFIG_FILE_NAME)

  await fs.mkdir(aiexDir, { recursive: true })
  await writeJsonFile(configPath, config, { spaces: 2, EOL: '\n' })
  await addToGitignore(aiexDir, CONFIG_FILE_NAME)
}

export function getDefaultAIConfig(): AIConfig {
  return structuredClone(DEFAULT_AI_CONFIG)
}

async function addToGitignore(aiexDir: string, fileName: string): Promise<void> {
  const projectRoot = path.dirname(aiexDir)
  const gitignorePath = path.join(projectRoot, GITIGNORE_FILE)

  try {
    const content = await fs.readFile(gitignorePath, 'utf-8')
    const lines = content.split('\n')

    if (lines.some(line => line.trim() === fileName || line.includes('.aiex/'))) {
      return
    }

    const newContent = content.endsWith('\n')
      ? `${content}${fileName}\n`
      : `${content}\n${fileName}\n`
    await fs.writeFile(gitignorePath, newContent)
  }
  catch {
    await fs.writeFile(gitignorePath, `${fileName}\n`)
  }
}
