import { describe, expect, it } from 'vitest'
import { classifyInputError, formatInputProcessing, mergeQuality } from '@/application/extraction/quality'

describe('quality', () => {
  describe('formatInputProcessing', () => {
    it('should format input processing with converter info', () => {
      const input = { handler: 'pdf_converter' as const, converter: 'unpdf', mime: 'application/pdf', kind: 'pdf' as const }
      expect(formatInputProcessing(input)).toBe('application/pdf -> pdf_converter(unpdf)')
    })

    it('should format input processing without converter', () => {
      const input = { handler: 'text_handler', mime: 'text/plain', kind: 'text' } as any
      expect(formatInputProcessing(input)).toBe('text/plain -> text_handler')
    })

    it('should fall back to kind when mime is not available', () => {
      const input = { handler: 'image_local_ocr' as const, kind: 'image' as const }
      expect(formatInputProcessing(input)).toBe('image -> image_local_ocr')
    })
  })

  describe('mergeQuality', () => {
    it('should merge input and AI quality metrics', () => {
      const inputQuality = {
        input: {
          pdf: { pageCount: 2, textLength: 1000, fallbackUsed: false },
        },
      }
      const aiQuality = {
        ai: {
          totalFields: 5,
          populatedFields: 4,
          missingFieldRate: 0.2,
        },
      }
      const merged = mergeQuality(inputQuality as any, aiQuality as any)
      expect(merged?.input).toBeDefined()
      expect(merged?.ai).toBeDefined()
    })

    it('should return undefined when both are undefined', () => {
      expect(mergeQuality(undefined, undefined)).toBeUndefined()
    })
  })

  describe('classifyInputError', () => {
    it('should classify PDF converter error', () => {
      const error = new Error('PDF conversion failed')
      const inputProcessing = { handler: 'pdf_converter' as const, mime: 'application/pdf', kind: 'pdf' as const }
      expect(classifyInputError(error, inputProcessing)).toBe('file_conversion')
    })

    it('should classify OCR error', () => {
      const error = new Error('OCR failed')
      const inputProcessing = { handler: 'image_local_ocr' as const, mime: 'image/png', kind: 'image' as const }
      expect(classifyInputError(error, inputProcessing)).toBe('ocr')
    })

    it('should classify by message content when no input processing', () => {
      expect(classifyInputError(new Error('ocr timeout'))).toBe('ocr')
      expect(classifyInputError(new Error('pdf converter crashed'))).toBe('file_conversion')
    })

    it('should default to input_detection for unknown errors', () => {
      expect(classifyInputError(new Error('unknown error'))).toBe('input_detection')
    })

    it('should handle non-Error objects', () => {
      expect(classifyInputError('some string error')).toBe('input_detection')
    })
  })
})
