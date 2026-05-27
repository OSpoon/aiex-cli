import fs from 'node:fs/promises'
import path from 'node:path'
import { writeFile as writeJsonFile } from 'jsonfile'

export async function writeExtractionOutput(input: {
  aiexDir: string
  outputDir: string
  tableName: string
  data: unknown
}): Promise<string> {
  const outputDir = path.resolve(input.aiexDir, input.outputDir.replace('.aiex/', ''))
  await fs.mkdir(outputDir, { recursive: true })

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const outputFileName = `${input.tableName}-${timestamp}.json`
  const outputPath = path.join(outputDir, outputFileName)

  await writeJsonFile(outputPath, input.data, { spaces: 2, EOL: '\n' })
  return outputPath
}
