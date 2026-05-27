import { t } from '@/locales'
import { detectInputBufferKind } from './input-file-kind'

export const MAX_UPLOAD_SIZE = 30 * 1024 * 1024

export const MAX_UPLOAD_SIZE_TEXT = '30MB'

export const SUPPORTED_FILE_TYPES_TEXT = 'images, PDF, text, markdown, CSV, JSON, HTML, XML, YAML'

export const MISSING_UPLOAD_FILE_TEXT = t('errors.file.missingUpload')

export const SUPPORTED_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'application/pdf',
  'text/plain',
  'text/markdown',
  'text/csv',
  'application/json',
  'text/html',
  'text/xml',
  'application/x-yaml',
  'text/yaml',
])

export const IMAGE_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
])

const MIME_TO_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
  'text/plain': 'txt',
  'text/markdown': 'md',
  'text/csv': 'csv',
  'application/json': 'json',
  'text/html': 'html',
  'text/xml': 'xml',
  'application/x-yaml': 'yaml',
  'text/yaml': 'yaml',
}

export function bytesToMB(bytes: number): number {
  return bytes / (1024 * 1024)
}

export function getExtensionFromMime(mimeType: string): string | undefined {
  return MIME_TO_EXT[mimeType]
}

export function getExtensionForDetectedFile(mimeType: string | undefined): string {
  return mimeType ? (getExtensionFromMime(mimeType) ?? 'txt') : 'txt'
}

export function isAllowedMimeType(mimeType: string): boolean {
  return SUPPORTED_MIME_TYPES.has(mimeType)
}

export function unsupportedFileTypeMessage(mimeType: string): string {
  return t('errors.file.unsupportedType', { type: mimeType, supported: SUPPORTED_FILE_TYPES_TEXT })
}

export function isMissingUploadFileError(error: unknown): boolean {
  return !!error && typeof error === 'object' && (error as NodeJS.ErrnoException).code === 'ENOENT'
}

export class FileValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FileValidationError'
  }
}

export function validateFileUpload(file: File): void {
  if (file.size === 0) {
    throw new FileValidationError(t('errors.file.empty'))
  }
  if (file.size > MAX_UPLOAD_SIZE) {
    throw new FileValidationError(
      t('errors.file.sizeExceeded', { size: bytesToMB(file.size).toFixed(1), limit: MAX_UPLOAD_SIZE_TEXT, file: file.name }),
    )
  }
  if (!isAllowedMimeType(file.type)) {
    throw new FileValidationError(
      unsupportedFileTypeMessage(file.type),
    )
  }
}

export async function validateFileUploadContent(file: File, buffer: Uint8Array): Promise<string> {
  if (file.size === 0) {
    throw new FileValidationError(t('errors.file.empty'))
  }
  if (file.size > MAX_UPLOAD_SIZE) {
    throw new FileValidationError(
      t('errors.file.sizeExceeded', { size: bytesToMB(file.size).toFixed(1), limit: MAX_UPLOAD_SIZE_TEXT, file: file.name }),
    )
  }

  const detected = await detectInputBufferKind(buffer)
  if (detected.kind === 'unsupported') {
    throw new FileValidationError(
      unsupportedFileTypeMessage(detected.mime ?? (file.type || 'application/octet-stream')),
    )
  }
  return detected.mime ?? 'text/plain'
}
