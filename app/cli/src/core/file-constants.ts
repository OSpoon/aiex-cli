export const MAX_UPLOAD_SIZE = 150 * 1024 * 1024

export const MAX_UPLOAD_SIZE_TEXT = '150MB'

export const SUPPORTED_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/bmp',
  'image/svg+xml',
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
  'image/gif',
  'image/webp',
  'image/bmp',
  'image/svg+xml',
])

const MIME_TO_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/bmp': 'bmp',
  'image/svg+xml': 'svg',
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

export function isAllowedMimeType(mimeType: string): boolean {
  return SUPPORTED_MIME_TYPES.has(mimeType)
}

export class FileValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FileValidationError'
  }
}

export function validateFileUpload(file: File): void {
  if (file.size === 0) {
    throw new FileValidationError('Uploaded file is empty')
  }
  if (file.size > MAX_UPLOAD_SIZE) {
    throw new FileValidationError(
      `File size (${bytesToMB(file.size).toFixed(1)}MB) exceeds ${MAX_UPLOAD_SIZE_TEXT} limit`,
    )
  }
  if (!isAllowedMimeType(file.type)) {
    throw new FileValidationError(
      `Unsupported file type "${file.type}". Supported types: ${[...SUPPORTED_MIME_TYPES].join(', ')}`,
    )
  }
}
