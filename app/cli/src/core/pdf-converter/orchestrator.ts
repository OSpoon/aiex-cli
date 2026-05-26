import type { AIConfig, ExtractFileInput } from '@/types'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { consola } from 'consola'
import { transcribeImageWithVision } from '@/core/ai-extraction/transcriber'
import {
  bytesToMB,
  MAX_UPLOAD_SIZE,
  MAX_UPLOAD_SIZE_TEXT,
} from '@/core/file-constants'
import { recognizeImageText } from '@/core/image-ocr'
import { createPdfConverter } from '@/core/pdf-converter'
import { t } from '@/locales'

export const FILE_PART_EXTENSIONS = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'bmp',
  'svg',
])

const PDF_EXT_RE = /\.pdf$/i

export function isImageFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase().replace('.', '')
  return FILE_PART_EXTENSIONS.has(ext)
}

export async function readExtractFileInput(
  filePath: string,
  aiConfig?: AIConfig,
): Promise<ExtractFileInput> {
  const stat = fs.statSync(filePath)
  if (stat.size > MAX_UPLOAD_SIZE) {
    throw new Error(t('errors.file.sizeExceeded', {
      size: bytesToMB(stat.size).toFixed(1),
      limit: MAX_UPLOAD_SIZE_TEXT,
      file: filePath,
    }))
  }
  const ext = path.extname(filePath).toLowerCase().replace('.', '')
  if (FILE_PART_EXTENSIONS.has(ext)) {
    const image = aiConfig?.image
    if (image?.imageConversion === 'vision' && image.imageModelName && aiConfig) {
      const baseURL = image.visionBaseURL || aiConfig.provider.baseURL
      const apiKey = image.visionApiKey || aiConfig.provider.apiKey
      const timeout = (aiConfig.provider.timeout ?? 300) * 1000
      try {
        const result = await transcribeImageWithVision(filePath, baseURL, apiKey, image.imageModelName, timeout)
        consola.info(t('command.extract.file.visionTranscribed', { model: result.modelName }))
        return { text: result.text }
      }
      catch {
        consola.warn(t('command.extract.file.visionTranscribeFailed', { model: image.imageModelName }))
      }
    }
    const result = await recognizeImageText(filePath, aiConfig?.image)
    consola.info(t('command.extract.file.ocrText', { confidence: (result.confidence * 100).toFixed(1) }))
    return { text: result.text }
  }
  if (ext === 'pdf') {
    const buffer = await fsp.readFile(filePath)
    const converter = createPdfConverter(aiConfig?.pdf)
    const result = await converter.convert(buffer, filePath)
    if (result.metadata?.fallback === 'true') {
      consola.info(t('command.extract.file.pdfFallback', { count: result.pageCount }))
    }
    else {
      consola.info(t('command.extract.file.pdfConverted', { name: converter.name, count: result.pageCount }))
    }
    // Save markdown alongside source PDF for reference
    const mdPath = filePath.replace(PDF_EXT_RE, '.md')
    try {
      await fsp.writeFile(mdPath, result.text)
      consola.info(t('command.extract.file.markdownSaved', { path: mdPath }))
    }
    catch {
      // Fallback: save to temp when source dir is not writable
      const fallbackMd = path.join(os.tmpdir(), `${path.basename(filePath, '.pdf')}.md`)
      await fsp.writeFile(fallbackMd, result.text)
      consola.info(t('command.extract.file.markdownSaved', { path: fallbackMd }))
    }
    return { text: result.text }
  }
  return { text: await fsp.readFile(filePath, 'utf-8') }
}
