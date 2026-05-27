import { Buffer } from 'node:buffer'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { detectMimeType, readFilePart } from '@/core/ai-extraction/file-utils'

vi.mock('@/infrastructure/input/detect-file-kind', () => ({
  detectInputFileKind: vi.fn(),
}))

describe('file-utils', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aiex-file-utils-'))
  })

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
    vi.clearAllMocks()
  })

  describe('detectMimeType', () => {
    it('should detect mime type from detectInputFileKind when available', async () => {
      const { detectInputFileKind } = await import('@/infrastructure/input/detect-file-kind')
      vi.mocked(detectInputFileKind).mockResolvedValue({ mime: 'text/plain', kind: 'text' })

      const filePath = path.join(tempDir, 'test.txt')
      fs.writeFileSync(filePath, 'hello')

      const mime = await detectMimeType(filePath)
      expect(mime).toBe('text/plain')
    })

    it('should fall back to mime lookup when detectInputFileKind has no mime', async () => {
      const { detectInputFileKind } = await import('@/infrastructure/input/detect-file-kind')
      vi.mocked(detectInputFileKind).mockResolvedValue({ kind: 'text' })

      const filePath = path.join(tempDir, 'test.txt')
      fs.writeFileSync(filePath, 'hello')

      const mime = await detectMimeType(filePath)
      expect(mime).toBe('text/plain')
    })

    it('should return application/octet-stream as last resort', async () => {
      const { detectInputFileKind } = await import('@/infrastructure/input/detect-file-kind')
      vi.mocked(detectInputFileKind).mockResolvedValue({ kind: 'unsupported' })

      const filePath = path.join(tempDir, 'test.unknown_ext_xyz')
      fs.writeFileSync(filePath, 'data')

      const mime = await detectMimeType(filePath)
      expect(mime).toBe('application/octet-stream')
    })
  })

  describe('readFilePart', () => {
    it('should read image file and return ImageContentPart', async () => {
      const { detectInputFileKind } = await import('@/infrastructure/input/detect-file-kind')
      vi.mocked(detectInputFileKind).mockResolvedValue({ mime: 'image/png', kind: 'image' })

      const filePath = path.join(tempDir, 'test.png')
      const content = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])
      fs.writeFileSync(filePath, content)

      const result = await readFilePart(filePath)
      expect(result.type).toBe('image')
      if (result.type === 'image') {
        expect(result.mimeType).toBe('image/png')
        expect(result.image).toBeInstanceOf(Uint8Array)
      }
    })

    it('should read non-image file and return FileContentPart', async () => {
      const { detectInputFileKind } = await import('@/infrastructure/input/detect-file-kind')
      vi.mocked(detectInputFileKind).mockResolvedValue({ mime: 'application/pdf', kind: 'pdf' })

      const filePath = path.join(tempDir, 'test.pdf')
      fs.writeFileSync(filePath, '%PDF-1.4 content')

      const result = await readFilePart(filePath)
      expect(result.type).toBe('file')
      if (result.type === 'file') {
        expect(result.mediaType).toBe('application/pdf')
        expect(result.filename).toBe('test.pdf')
        expect(result.data).toBeInstanceOf(Uint8Array)
      }
    })
  })
})
