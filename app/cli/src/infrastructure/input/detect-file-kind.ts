import type { InputFileKindResult } from '@/domain/input/types'
import fs from 'node:fs/promises'
import { TextDecoder } from 'node:util'
import { fileTypeFromBuffer, fileTypeFromFile } from 'file-type'

const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true })
const SVG_START_RE = /^\s*<svg[\s>]/i
const SVG_ANY_RE = /<svg[\s>]/i

export const SUPPORTED_IMAGE_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
])

export function isSupportedImageMime(mime?: string): boolean {
  return !!mime && SUPPORTED_IMAGE_MIME_TYPES.has(mime)
}

function detectTextKind(buffer: Uint8Array): InputFileKindResult {
  try {
    const text = UTF8_DECODER.decode(buffer)
    if (SVG_START_RE.test(text) || SVG_ANY_RE.test(text.slice(0, 4096)))
      return { kind: 'unsupported', mime: 'image/svg+xml' }
    return { kind: 'text', mime: 'text/plain' }
  }
  catch {
    return { kind: 'unsupported' }
  }
}

export async function detectInputFileKind(filePath: string): Promise<InputFileKindResult> {
  const detected = await fileTypeFromFile(filePath)
  if (detected?.mime === 'application/pdf')
    return { kind: 'pdf', mime: detected.mime }
  if (isSupportedImageMime(detected?.mime))
    return { kind: 'image', mime: detected?.mime }

  const buffer = await fs.readFile(filePath)
  return detectTextKind(buffer)
}

export async function detectInputBufferKind(buffer: Uint8Array): Promise<InputFileKindResult> {
  const detected = await fileTypeFromBuffer(buffer)
  if (detected?.mime === 'application/pdf')
    return { kind: 'pdf', mime: detected.mime }
  if (isSupportedImageMime(detected?.mime))
    return { kind: 'image', mime: detected?.mime }
  return detectTextKind(buffer)
}
