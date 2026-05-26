import type { ReadFilePartResult } from '@/types'
import fs from 'node:fs/promises'
import path from 'node:path'
import mime from 'mime'

export function detectMimeType(filePath: string): string {
  return mime.getType(filePath) ?? 'application/octet-stream'
}

export async function readFilePart(filePath: string): Promise<ReadFilePartResult> {
  const mimeStr = detectMimeType(filePath)
  const buffer = await fs.readFile(filePath)
  const name = path.basename(filePath)

  if (mimeStr.startsWith('image/')) {
    return { type: 'image', image: buffer, mimeType: mimeStr }
  }
  return { type: 'file', data: buffer, mediaType: mimeStr, filename: name }
}
