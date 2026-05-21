import type { MigrationConfig } from '@/core/schema-sqlite/types'
import { Buffer } from 'node:buffer'
import fs from 'node:fs/promises'
import path from 'node:path'
import { Hono } from 'hono'
import { readAIConfig } from '@/core/ai-extraction'
import {
  extractSingle,
  readExtractFileInput,
} from '@/core/extract-runner'
import {
  createExtractionAuditRecord,
  deleteExtractionAuditRecord,
  listExtractionAuditRecords,
  readExtractionAuditRecord,
  updateExtractionAuditRecord,
} from '@/core/extraction-audit'
import {
  FileValidationError,
  getExtensionFromMime,
  validateFileUpload,
} from '@/core/file-constants'
import { writeNotionPage } from '@/core/notion-sink'

interface ExtractResponse {
  success: boolean
  error?: string
  outputPath?: string
  outputName?: string
  tablesInserted?: Array<{ table: string, rowId: number }>
  notionPages?: Array<{ databaseId: string, pageId: string }>
  tokensUsed?: {
    prompt: number
    completion: number
    total: number
  }
  auditId?: string
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

function safeUploadNameForMime(file: File): string {
  const safeName = safeUploadName(file.name)
  const ext = getExtensionFromMime(file.type)
  if (!ext)
    throw new FileValidationError(`Unsupported file type "${file.type}"`)

  const parsed = path.parse(safeName)
  const stem = parsed.name || 'upload'
  return `${stem}.${ext}`
}

async function saveUploadToFile(file: File, uploadsDir: string, id: string): Promise<string> {
  validateFileUpload(file)
  await fs.mkdir(uploadsDir, { recursive: true })
  const filePath = path.join(uploadsDir, `${id}-${safeUploadNameForMime(file)}`)
  const buffer = Buffer.from(await file.arrayBuffer())
  await fs.writeFile(filePath, buffer)
  return filePath
}

async function executeAuditedExtraction(input: {
  aiexDir: string
  config: MigrationConfig
  auditId: string
  schemaName: string
  text: string
  filePath?: string
  modelName?: string
}): Promise<Response> {
  const aiConfig = await readAIConfig(input.aiexDir)
  if (!aiConfig) {
    const record = await updateExtractionAuditRecord(input.aiexDir, input.auditId, {
      status: 'failed',
      error: 'AI configuration not found. Configure AI settings first.',
    })
    return new Response(JSON.stringify({ success: false, error: record.error, auditId: record.id }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    })
  }
  if (!aiConfig.provider.apiKey) {
    const record = await updateExtractionAuditRecord(input.aiexDir, input.auditId, {
      status: 'failed',
      error: 'API Key not configured. Configure AI settings first.',
    })
    return new Response(JSON.stringify({ success: false, error: record.error, auditId: record.id }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    })
  }
  if (!aiConfig.provider.models?.length) {
    const record = await updateExtractionAuditRecord(input.aiexDir, input.auditId, {
      status: 'failed',
      error: 'No models configured. Add at least one model in AI Settings.',
    })
    return new Response(JSON.stringify({ success: false, error: record.error, auditId: record.id }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    })
  }

  const modelOverride = input.modelName
    ? aiConfig.provider.models.find(model => model.name === input.modelName)
    : undefined
  if (input.modelName && !modelOverride) {
    const record = await updateExtractionAuditRecord(input.aiexDir, input.auditId, {
      status: 'failed',
      error: `Model "${input.modelName}" not found in AI settings`,
    })
    return new Response(JSON.stringify({ success: false, error: record.error, auditId: record.id }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    })
  }

  let inputText = input.text
  let inputFilePath = input.filePath

  if (input.filePath) {
    const source = await readExtractFileInput(input.filePath, aiConfig)
    inputText = source.text
    inputFilePath = source.filePath
  }

  const result = await extractSingle(
    input.aiexDir,
    input.config,
    aiConfig,
    input.schemaName,
    inputText,
    inputFilePath,
    modelOverride,
    { quiet: true },
  )

  if (!result.success) {
    const record = await updateExtractionAuditRecord(input.aiexDir, input.auditId, {
      status: 'failed',
      error: result.error || 'Extraction failed',
    })
    return new Response(JSON.stringify({ success: false, error: record.error, auditId: record.id }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    })
  }

  const notionPages: Array<{ databaseId: string, pageId: string }> = []
  if (aiConfig.notion?.enabled && aiConfig.notion.schemas?.[input.schemaName]?.databaseId?.trim()) {
    try {
      if (!result.data || typeof result.data !== 'object' || Array.isArray(result.data))
        throw new Error('Extraction result is not an object and cannot be written to Notion.')
      notionPages.push(await writeNotionPage(
        aiConfig.notion,
        input.schemaName,
        result.data as Record<string, unknown>,
      ))
    }
    catch (error) {
      const record = await updateExtractionAuditRecord(input.aiexDir, input.auditId, {
        status: 'failed',
        outputPath: result.outputPath,
        outputName: result.outputPath ? path.basename(result.outputPath) : undefined,
        tablesInserted: result.tablesInserted,
        tokensUsed: result.tokensUsed,
        error: error instanceof Error ? error.message : String(error),
      })
      return new Response(JSON.stringify({ success: false, error: record.error, auditId: record.id }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      })
    }
  }

  const record = await updateExtractionAuditRecord(input.aiexDir, input.auditId, {
    status: 'succeeded',
    outputPath: result.outputPath,
    outputName: result.outputPath ? path.basename(result.outputPath) : undefined,
    tablesInserted: result.tablesInserted,
    notionPages: notionPages.length > 0 ? notionPages : undefined,
    tokensUsed: result.tokensUsed,
  })

  return new Response(JSON.stringify({
    success: true,
    outputPath: record.outputPath,
    outputName: record.outputName,
    tablesInserted: record.tablesInserted,
    notionPages: record.notionPages,
    tokensUsed: record.tokensUsed,
    auditId: record.id,
  }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

export function extractRoutes(config: MigrationConfig): Hono {
  const app = new Hono()
  const aiexDir = path.dirname(config.schemaPath)
  const uploadsDir = path.join(aiexDir, 'uploads')

  app.get('/extract/records', async (c) => {
    return c.json(await listExtractionAuditRecords(aiexDir))
  })

  app.post('/extract', async (c) => {
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

      const audit = await createExtractionAuditRecord(aiexDir, {
        schemaName,
        modelName,
        source: file
          ? { type: 'file', fileName: safeUploadName(file.name) }
          : { type: 'text', text },
      })

      let filePath: string | undefined
      if (file) {
        try {
          filePath = await saveUploadToFile(file, uploadsDir, audit.id)
        }
        catch (e) {
          if (e instanceof FileValidationError) {
            await updateExtractionAuditRecord(aiexDir, audit.id, { status: 'failed', error: e.message })
            return c.json<ExtractResponse>({ success: false, error: e.message }, 400)
          }
          throw e
        }
        await updateExtractionAuditRecord(aiexDir, audit.id, {
          source: { type: 'file', filePath, fileName: path.basename(filePath) },
        })
      }

      return executeAuditedExtraction({
        aiexDir,
        config,
        auditId: audit.id,
        schemaName,
        text,
        filePath,
        modelName,
      })
    }
    catch (error: unknown) {
      return c.json<ExtractResponse>({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }, 500)
    }
  })

  app.post('/extract/records/:id/retry', async (c) => {
    const id = c.req.param('id')
    const original = await readExtractionAuditRecord(aiexDir, id)
    if (!original) {
      return c.json<ExtractResponse>({ success: false, error: 'Extraction record not found' }, 404)
    }

    const audit = await createExtractionAuditRecord(aiexDir, {
      schemaName: original.schemaName,
      modelName: original.modelName,
      source: original.source,
      retryOf: original.id,
    })

    return executeAuditedExtraction({
      aiexDir,
      config,
      auditId: audit.id,
      schemaName: original.schemaName,
      text: original.source.type === 'text' ? original.source.text ?? '' : '',
      filePath: original.source.type === 'file' ? original.source.filePath : undefined,
      modelName: original.modelName,
    })
  })

  app.delete('/extract/records/:id', async (c) => {
    const id = c.req.param('id')
    const record = await readExtractionAuditRecord(aiexDir, id)
    if (!record) {
      return c.json({ success: false, error: 'Extraction record not found' }, 404)
    }
    await deleteExtractionAuditRecord(aiexDir, id)
    return c.json({ success: true })
  })

  return app
}
