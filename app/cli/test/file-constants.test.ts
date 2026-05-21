import { describe, expect, it } from 'vitest'
import {
  bytesToMB,
  FileValidationError,
  getExtensionFromMime,
  isAllowedMimeType,
  isMissingUploadFileError,
  MAX_UPLOAD_SIZE,
  SUPPORTED_FILE_TYPES_TEXT,
  unsupportedFileTypeMessage,
  validateFileUpload,
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
      expect(() => validateFileUpload(file)).toThrow('exceeds 150MB limit')
    })

    it('rejects unsupported MIME types', () => {
      const file = new File(['hello'], 'hello.bin', { type: 'application/octet-stream' })

      expect(() => validateFileUpload(file)).toThrow(FileValidationError)
      expect(() => validateFileUpload(file)).toThrow(unsupportedFileTypeMessage('application/octet-stream'))
    })
  })
})
