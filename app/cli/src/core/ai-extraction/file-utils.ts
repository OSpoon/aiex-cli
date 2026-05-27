import fs from 'node:fs/promises'
import path from 'node:path'
import mime from 'mime'
import { detectInputFileKind } from '@/core/input-file-kind'

export async function detectMimeType(filePath: string): Promise<string> {
  const detected = await detectInputFileKind(filePath)
  return detected.mime ?? mime.getType(filePath) ?? 'application/octet-stream'
}

export interface ImageContentPart { type: 'image', image: Uint8Array, mimeType?: string }
export interface FileContentPart { type: 'file', data: Uint8Array, mediaType: string, filename?: string }
export type ReadFilePartResult = ImageContentPart | FileContentPart

export async function readFilePart(filePath: string): Promise<ReadFilePartResult> {
  const mimeStr = await detectMimeType(filePath)
  const buffer = await fs.readFile(filePath)
  const name = path.basename(filePath)

  if (mimeStr.startsWith('image/')) {
    return { type: 'image', image: buffer, mimeType: mimeStr }
  }
  return { type: 'file', data: buffer, mediaType: mimeStr, filename: name }
}
