import type { MigrationConfig } from '@/core/schema-sqlite/types'
import { Buffer } from 'node:buffer'
import fs from 'node:fs/promises'
import path from 'node:path'
import { Hono } from 'hono'
import { readAIConfig } from '@/core/ai-extraction'
import {
  runAuditedExtraction,
} from '@/core/extract-runner'
import {
  deleteExtractionAuditRecord,
  listExtractionAuditRecords,
  readExtractionAuditRecord,
} from '@/core/extraction-audit'
import {
  FileValidationError,
  getExtensionForDetectedFile,
  isMissingUploadFileError,
  MISSING_UPLOAD_FILE_TEXT,
  validateFileUploadContent,
} from '@/core/file-constants'
import { createMigrationConfig } from '@/core/schema-sqlite'
import { t } from '@/locales'

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
  inputProcessing?: {
    kind: 'pdf' | 'image' | 'text'
    mime?: string
    handler: 'text' | 'image_vision' | 'image_local_ocr' | 'pdf_converter'
    converter?: string
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

function safeUploadNameForMime(file: File, mimeType: string): string {
  const safeName = safeUploadName(file.name)
  const ext = getExtensionForDetectedFile(mimeType)

  const parsed = path.parse(safeName)
  const stem = parsed.name || 'upload'
  return `${stem}.${ext}`
}

function jsonResponse(body: ExtractResponse, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

async function saveUploadToFile(file: File, uploadsDir: string, id: string): Promise<string> {
  const buffer = Buffer.from(await file.arrayBuffer())
  const mimeType = await validateFileUploadContent(file, buffer)
  await fs.mkdir(uploadsDir, { recursive: true })
  const filePath = path.join(uploadsDir, `${id}-${safeUploadNameForMime(file, mimeType)}`)
  await fs.writeFile(filePath, buffer)
  return filePath
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
        return c.json<ExtractResponse>({ success: false, error: t('server.schemaRequired') }, 400)
      }

      if (!text && !file) {
        return c.json<ExtractResponse>({ success: false, error: t('server.provideTextOrFile') }, 400)
      }

      if (text && file) {
        return c.json<ExtractResponse>({ success: false, error: t('server.conflictTextAndFile') }, 400)
      }

      // Validate and save uploaded file early, before AI config checks
      // so MIME type errors surface with correct priority
      let source: { type: 'file', filePath: string } | { type: 'text', text: string }

      if (file) {
        const uploadId = `upload-${Date.now()}`
        let filePath: string
        try {
          filePath = await saveUploadToFile(file, uploadsDir, uploadId)
        }
        catch (e) {
          if (e instanceof FileValidationError) {
            return c.json<ExtractResponse>({ success: false, error: e.message }, 400)
          }
          throw e
        }
        source = { type: 'file', filePath }
      }
      else {
        source = { type: 'text', text }
      }

      const aiConfig = await readAIConfig(aiexDir)
      if (!aiConfig) {
        return c.json<ExtractResponse>({ success: false, error: t('server.aiConfigNotFound') }, 400)
      }
      if (!aiConfig.provider.apiKey) {
        return c.json<ExtractResponse>({ success: false, error: t('server.apiKeyNotConfigured') }, 400)
      }
      if (!aiConfig.provider.models?.length) {
        return c.json<ExtractResponse>({ success: false, error: t('server.noModelsConfigured') }, 400)
      }

      const modelOverride = modelName
        ? aiConfig.provider.models.find(model => model.name === modelName)
        : undefined
      if (modelName && !modelOverride) {
        return c.json<ExtractResponse>({ success: false, error: t('server.modelNotFound', { name: modelName }) }, 400)
      }

      const result = await runAuditedExtraction({
        aiexDir,
        config: createMigrationConfig(path.dirname(aiexDir)),
        aiConfig,
        schemaName,
        source,
        modelOverride,
        quiet: true,
      })

      if (!result.success) {
        return jsonResponse({ success: false, error: result.error, auditId: result.auditId }, 500)
      }

      return jsonResponse({
        success: true,
        outputPath: result.outputPath,
        outputName: result.outputName,
        tablesInserted: result.tablesInserted,
        notionPages: result.notionPages,
        tokensUsed: result.tokensUsed,
        auditId: result.auditId,
        inputProcessing: result.inputProcessing,
      }, 200)
    }
    catch (error: unknown) {
      if (isMissingUploadFileError(error)) {
        return c.json<ExtractResponse>({ success: false, error: MISSING_UPLOAD_FILE_TEXT }, 400)
      }
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
      return c.json<ExtractResponse>({ success: false, error: t('server.extractionRecordNotFound') }, 404)
    }

    const aiConfig = await readAIConfig(aiexDir)
    if (!aiConfig) {
      return c.json<ExtractResponse>({ success: false, error: t('server.aiConfigNotFound') }, 400)
    }
    if (!aiConfig.provider.apiKey) {
      return c.json<ExtractResponse>({ success: false, error: t('server.apiKeyNotConfigured') }, 400)
    }
    if (!aiConfig.provider.models?.length) {
      return c.json<ExtractResponse>({ success: false, error: t('server.noModelsConfigured') }, 400)
    }

    const modelOverride = original.modelName
      ? aiConfig.provider.models.find(m => m.name === original.modelName)
      : undefined
    if (original.modelName && !modelOverride) {
      return c.json<ExtractResponse>({ success: false, error: t('server.modelNotFound', { name: original.modelName }) }, 400)
    }

    const source = original.source.type === 'file' && original.source.filePath
      ? { type: 'file' as const, filePath: original.source.filePath }
      : { type: 'text' as const, text: original.source.text ?? '' }

    const result = await runAuditedExtraction({
      aiexDir,
      config: createMigrationConfig(path.dirname(aiexDir)),
      aiConfig,
      schemaName: original.schemaName,
      source,
      modelOverride,
      retryOf: original.id,
      force: true, // Retry always bypasses duplicate check
      quiet: true,
    })

    if (!result.success) {
      return jsonResponse({ success: false, error: result.error, auditId: result.auditId }, 500)
    }

    return jsonResponse({
      success: true,
      outputPath: result.outputPath,
      outputName: result.outputName,
      tablesInserted: result.tablesInserted,
      notionPages: result.notionPages,
      tokensUsed: result.tokensUsed,
      auditId: result.auditId,
      inputProcessing: result.inputProcessing,
    }, 200)
  })

  app.delete('/extract/records/:id', async (c) => {
    const id = c.req.param('id')
    const record = await readExtractionAuditRecord(aiexDir, id)
    if (!record) {
      return c.json({ success: false, error: t('server.extractionRecordNotFound') }, 404)
    }
    await deleteExtractionAuditRecord(aiexDir, id)
    return c.json({ success: true })
  })

  return app
}
