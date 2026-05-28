import type { AIConfig, AIModelConfig } from '@/domain/ai/types'
import type { ExtractFileInput, InputProcessingInfo } from '@/domain/input/types'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { consola } from 'consola'
import {
  bytesToMB,
  MAX_UPLOAD_SIZE,
  MAX_UPLOAD_SIZE_TEXT,
  unsupportedFileTypeMessage,
} from '@/application/input/file-policy'
import { detectInputFileKind } from '@/infrastructure/input/detect-file-kind'
import { recognizeImageText, shouldUseImageOcrFallback } from '@/infrastructure/ocr/system-ocr'
import { createPdfConverter } from '@/infrastructure/pdf'
import { t } from '@/locales'

export const FILE_PART_EXTENSIONS = new Set([
  'png',
  'jpg',
  'jpeg',
  'webp',
])

const PDF_EXT_RE = /\.pdf$/i

export function isImageFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase().replace('.', '')
  return FILE_PART_EXTENSIONS.has(ext)
}

export async function describeExtractFileInput(
  filePath: string,
  aiConfig?: AIConfig,
  modelOverride?: AIModelConfig,
): Promise<InputProcessingInfo> {
  const detected = await detectInputFileKind(filePath)

  if (detected.kind === 'image') {
    return {
      kind: 'image',
      mime: detected.mime,
      handler: shouldUseImageOcrFallback(aiConfig, modelOverride) ? 'image_local_ocr' : 'image_vision',
    }
  }

  if (detected.kind === 'pdf') {
    const converter = createPdfConverter(aiConfig?.pdf)
    return {
      kind: 'pdf',
      mime: detected.mime,
      handler: 'pdf_converter',
      converter: converter.name,
    }
  }

  if (detected.kind === 'text') {
    return {
      kind: 'text',
      mime: detected.mime,
      handler: 'text',
    }
  }

  throw new Error(unsupportedFileTypeMessage(detected.mime ?? 'application/octet-stream'))
}

export async function readExtractFileInput(
  filePath: string,
  aiConfig?: AIConfig,
  modelOverride?: AIModelConfig,
): Promise<ExtractFileInput> {
  const stat = fs.statSync(filePath)
  if (stat.size > MAX_UPLOAD_SIZE) {
    throw new Error(t('errors.file.sizeExceeded', {
      size: bytesToMB(stat.size).toFixed(1),
      limit: MAX_UPLOAD_SIZE_TEXT,
      file: filePath,
    }))
  }
  const inputProcessing = await describeExtractFileInput(filePath, aiConfig, modelOverride)
  if (inputProcessing.kind === 'image') {
    if (inputProcessing.handler === 'image_local_ocr') {
      const result = await recognizeImageText(filePath)
      consola.info(t('command.extract.file.ocrText', { confidence: (result.confidence * 100).toFixed(1) }))
      return {
        text: result.text,
        inputProcessing,
        quality: {
          input: {
            kind: 'image',
            textLength: result.text.length,
            emptyText: result.text.trim().length === 0,
            ocr: {
              confidence: result.confidence,
              textLength: result.text.length,
              platform: process.platform,
            },
          },
        },
      }
    }
    return {
      text: '',
      filePath,
      inputProcessing,
      quality: {
        input: { kind: 'image' },
      },
    }
  }
  if (inputProcessing.kind === 'pdf') {
    const buffer = await fsp.readFile(filePath)
    const converter = createPdfConverter(aiConfig?.pdf)
    const result = await converter.convert(buffer, filePath)
    if (result.metadata?.fallback === 'true') {
      consola.info(t('command.extract.file.pdfFallback', { count: result.pageCount }))
    }
    else {
      consola.info(t('command.extract.file.pdfConverted', { name: converter.name, count: result.pageCount }))
    }
    const mdPath = filePath.replace(PDF_EXT_RE, '.md')
    try {
      await fsp.writeFile(mdPath, result.text)
      consola.info(t('command.extract.file.markdownSaved', { path: mdPath }))
    }
    catch {
      const fallbackMd = path.join(os.tmpdir(), `${path.basename(filePath, '.pdf')}.md`)
      await fsp.writeFile(fallbackMd, result.text)
      consola.info(t('command.extract.file.markdownSaved', { path: fallbackMd }))
    }
    const textLength = result.text.length
    return {
      text: result.text,
      inputProcessing,
      quality: {
        input: {
          kind: 'pdf',
          textLength,
          emptyText: result.text.trim().length === 0,
          pdf: {
            pageCount: result.pageCount,
            textLength,
            emptyText: result.text.trim().length === 0,
            fallbackUsed: result.metadata?.fallback === 'true',
            converter: result.metadata?.converter ?? converter.name,
          },
        },
      },
    }
  }
  if (inputProcessing.kind === 'text') {
    const text = await fsp.readFile(filePath, 'utf-8')
    return {
      text,
      inputProcessing,
      quality: {
        input: {
          kind: 'text',
          textLength: text.length,
          emptyText: text.trim().length === 0,
        },
      },
    }
  }

  throw new Error(unsupportedFileTypeMessage(inputProcessing.mime ?? 'application/octet-stream'))
}
