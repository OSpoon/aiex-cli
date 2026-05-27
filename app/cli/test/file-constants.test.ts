import { Buffer } from 'node:buffer'
import { describe, expect, it } from 'vitest'
import {
  bytesToMB,
  FileValidationError,
  getExtensionFromMime,
  isAllowedMimeType,
  isMissingUploadFileError,
  MAX_UPLOAD_SIZE,
  MAX_UPLOAD_SIZE_TEXT,
  SUPPORTED_FILE_TYPES_TEXT,
  unsupportedFileTypeMessage,
  validateFileUpload,
  validateFileUploadContent,
} from '@/core/file-constants'

describe('file-constants', () => {
  describe('bytesToMB', () => {
    it('converts bytes to megabytes', () => {
      expect(bytesToMB(2 * 1024 * 1024)).toBe(2)
    })
  })

  describe('getExtensionFromMime', () => {
    it('returns the canonical extension for supported MIME types', () => {
      expect(getExtensionFromMime('image/jpeg')).toBe('jpg')
      expect(getExtensionFromMime('application/pdf')).toBe('pdf')
      expect(getExtensionFromMime('text/plain')).toBe('txt')
      expect(getExtensionFromMime('application/x-yaml')).toBe('yaml')
    })

    it('returns undefined for unsupported MIME types', () => {
      expect(getExtensionFromMime('application/octet-stream')).toBeUndefined()
    })
  })

  describe('isAllowedMimeType', () => {
    it('allows supported MIME types', () => {
      expect(isAllowedMimeType('image/png')).toBe(true)
      expect(isAllowedMimeType('text/html')).toBe(true)
    })

    it('rejects unsupported MIME types', () => {
      expect(isAllowedMimeType('application/octet-stream')).toBe(false)
    })
  })

  describe('unsupportedFileTypeMessage', () => {
    it('formats the shared unsupported type message', () => {
      expect(unsupportedFileTypeMessage('application/octet-stream'))
        .toBe(`Unsupported file type "application/octet-stream". Supported: ${SUPPORTED_FILE_TYPES_TEXT}.`)
    })
  })

  describe('isMissingUploadFileError', () => {
    it('detects missing file errors', () => {
      expect(isMissingUploadFileError(Object.assign(new Error('missing'), { code: 'ENOENT' }))).toBe(true)
    })

    it('ignores unrelated errors', () => {
      expect(isMissingUploadFileError(Object.assign(new Error('denied'), { code: 'EACCES' }))).toBe(false)
      expect(isMissingUploadFileError(new Error('plain'))).toBe(false)
      expect(isMissingUploadFileError(null)).toBe(false)
    })
  })

  describe('validateFileUpload', () => {
    it('accepts a supported non-empty file within the size limit', () => {
      const file = new File(['hello'], 'hello.txt', { type: 'text/plain' })

      expect(() => validateFileUpload(file)).not.toThrow()
    })

    it('rejects empty files', () => {
      const file = new File([], 'empty.txt', { type: 'text/plain' })

      expect(() => validateFileUpload(file)).toThrow(FileValidationError)
      expect(() => validateFileUpload(file)).toThrow('Uploaded file is empty')
    })

    it('rejects files larger than the size limit', () => {
      const file = { size: MAX_UPLOAD_SIZE + 1, type: 'text/plain' } as File

      expect(() => validateFileUpload(file)).toThrow(FileValidationError)
      expect(() => validateFileUpload(file)).toThrow(`exceeds ${MAX_UPLOAD_SIZE_TEXT} limit`)
    })

    it('rejects unsupported MIME types', () => {
      const file = new File(['hello'], 'hello.bin', { type: 'application/octet-stream' })

      expect(() => validateFileUpload(file)).toThrow(FileValidationError)
      expect(() => validateFileUpload(file)).toThrow(unsupportedFileTypeMessage('application/octet-stream'))
    })
  })

  describe('validateFileUploadContent', () => {
    it('accepts supported content even when browser MIME is generic', async () => {
      const file = new File(['%PDF-1.4\n'], 'document.bin', { type: 'application/octet-stream' })

      await expect(validateFileUploadContent(file, Buffer.from('%PDF-1.4\n'))).resolves.toBe('application/pdf')
    })

    it('rejects unsupported binary content', async () => {
      const file = new File([new Uint8Array([0xFF, 0x00, 0x01])], 'file.bin', { type: 'application/octet-stream' })

      await expect(validateFileUploadContent(file, new Uint8Array([0xFF, 0x00, 0x01]))).rejects.toThrow(FileValidationError)
    })

    it('rejects SVG content as unsupported image input', async () => {
      const svg = '<svg xmlns="http://www.w3.org/2000/svg"></svg>'
      const file = new File([svg], 'icon.svg', { type: 'image/svg+xml' })

      await expect(validateFileUploadContent(file, Buffer.from(svg))).rejects.toThrow(FileValidationError)
    })
  })
})
