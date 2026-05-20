import type { AIModelConfig } from '@/core/ai-extraction/types'
import type { MigrationConfig } from '@/core/schema-sqlite/types'
import { Buffer } from 'node:buffer'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Hono } from 'hono'
import { readAIConfig } from '@/core/ai-extraction'
import {
  extractSingle,
  readExtractFileInput,
} from '@/core/extract-runner'

interface ExtractResponse {
  success: boolean
  error?: string
  outputPath?: string
  outputName?: string
  tablesInserted?: Array<{ table: string, rowId: number }>
  tokensUsed?: {
    prompt: number
    completion: number
    total: number
  }
}

type BodyValue = string | File

function getFormString(value: BodyValue | BodyValue[] | undefined): string {
  if (Array.isArray(value))
    return getFormString(value[0])
  return typeof value === 'string' ? value.trim() : ''
}

function getFormFile(value: BodyValue | BodyValue[] | undefined): File | null {
  if (Array.isArray(value))
    return getFormFile(value[0])
  return value instanceof File && value.size > 0 ? value : null
}

function safeUploadName(name: string): string {
  const base = path.basename(name).replace(/[^\w.-]/g, '_')
  return base || 'upload.txt'
}

async function saveUploadToTemp(file: File): Promise<{ dir: string, path: string }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aiex-web-extract-'))
  const filePath = path.join(dir, safeUploadName(file.name))
  const buffer = Buffer.from(await file.arrayBuffer())
  await fs.writeFile(filePath, buffer)
  return { dir, path: filePath }
}

export function extractRoutes(config: MigrationConfig): Hono {
  const app = new Hono()
  const aiexDir = path.dirname(config.schemaPath)

  app.post('/extract', async (c) => {
    let tempDir: string | undefined

    try {
      const body = await c.req.parseBody()
      const schemaName = getFormString(body.schema)
      const text = getFormString(body.text)
      const modelName = getFormString(body.model)
      const file = getFormFile(body.file)

      if (!schemaName) {
        return c.json<ExtractResponse>({ success: false, error: 'Schema is required' }, 400)
      }

      if (!text && !file) {
        return c.json<ExtractResponse>({ success: false, error: 'Provide text or upload a file to extract' }, 400)
      }

      if (text && file) {
        return c.json<ExtractResponse>({ success: false, error: 'Text and file input cannot be used together' }, 400)
      }

      const aiConfig = await readAIConfig(aiexDir)
      if (!aiConfig) {
        return c.json<ExtractResponse>({ success: false, error: 'AI configuration not found. Configure AI settings first.' }, 400)
      }
      if (!aiConfig.provider.apiKey) {
        return c.json<ExtractResponse>({ success: false, error: 'API Key not configured. Configure AI settings first.' }, 400)
      }
      if (!aiConfig.provider.models?.length) {
        return c.json<ExtractResponse>({ success: false, error: 'No models configured. Add at least one model in AI Settings.' }, 400)
      }

      let modelOverride: AIModelConfig | undefined
      if (modelName) {
        modelOverride = aiConfig.provider.models.find(model => model.name === modelName)
        if (!modelOverride) {
          return c.json<ExtractResponse>({ success: false, error: `Model "${modelName}" not found in AI settings` }, 400)
        }
      }

      let inputText = text
      let inputFilePath: string | undefined

      if (file) {
        const saved = await saveUploadToTemp(file)
        tempDir = saved.dir
        const input = await readExtractFileInput(saved.path, aiConfig)
        inputText = input.text
        inputFilePath = input.filePath
      }

      const result = await extractSingle(
        aiexDir,
        config,
        aiConfig,
        schemaName,
        inputText,
        inputFilePath,
        modelOverride,
        { quiet: true },
      )

      if (!result.success) {
        return c.json<ExtractResponse>({ success: false, error: result.error || 'Extraction failed' }, 500)
      }

      return c.json<ExtractResponse>({
        success: true,
        outputPath: result.outputPath,
        outputName: result.outputPath ? path.basename(result.outputPath) : undefined,
        tablesInserted: result.tablesInserted,
        tokensUsed: result.tokensUsed,
      })
    }
    catch (error: unknown) {
      return c.json<ExtractResponse>({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }, 500)
    }
    finally {
      if (tempDir)
        await fs.rm(tempDir, { recursive: true, force: true })
    }
  })

  return app
}
