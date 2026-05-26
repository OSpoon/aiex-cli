import { describe, expect, it } from 'vitest'
import { checkImageOcrAvailability, isLocalOcrPlatform, recognizeImageText } from '@/core/image-ocr'

describe('isLocalOcrPlatform', () => {
  it('returns true for darwin and win32', () => {
    expect(isLocalOcrPlatform('darwin')).toBe(true)
    expect(isLocalOcrPlatform('win32')).toBe(true)
  })

  it('returns false for linux and other platforms', () => {
    expect(isLocalOcrPlatform('linux')).toBe(false)
    expect(isLocalOcrPlatform('aix')).toBe(false)
  })
})

describe('recognizeImageText', () => {
  it('recognizes text with the local OCR runtime', async () => {
    const result = await recognizeImageText('/tmp/image.png', {
      ocrLanguages: 'en-US',
      ocrMinConfidence: 0.5,
    }, {
      platform: 'darwin',
      async loadLocalOcr() {
        return {
          OcrAccuracy: { Fast: 0, Accurate: 1 },
          async recognize(imagePath, accuracy, languages) {
            expect(imagePath).toBe('/tmp/image.png')
            expect(accuracy).toBe(1)
            expect(languages).toEqual(['en-US'])
            return { text: '  invoice total  ', confidence: 0.93 }
          },
        }
      },
    })

    expect(result).toEqual({ text: 'invoice total', confidence: 0.93 })
  })

  it('rejects local OCR on unsupported runtimes', async () => {
    await expect(recognizeImageText('/tmp/image.png', undefined, {
      platform: 'linux',
      async loadLocalOcr() {
        throw new Error('should not load')
      },
    })).rejects.toThrow('only available on macOS or Windows')
  })

  it('reports unsupported platforms in OCR self-check', async () => {
    const result = await checkImageOcrAvailability('/tmp/logo.png', {
      platform: 'linux',
      async loadLocalOcr() {
        throw new Error('should not load')
      },
    })

    expect(result).toEqual({
      platformSupported: false,
      dependencyLoaded: false,
      ocrOk: null,
      imagePath: '/tmp/logo.png',
      error: 'Local OCR is only available on macOS or Windows. Current platform: linux.',
    })
  })

  it('reports dependency load failures in OCR self-check', async () => {
    const result = await checkImageOcrAvailability('/tmp/logo.png', {
      platform: 'darwin',
      async loadLocalOcr() {
        throw new Error('binding missing')
      },
    })

    expect(result).toEqual({
      platformSupported: true,
      dependencyLoaded: false,
      ocrOk: null,
      imagePath: '/tmp/logo.png',
      error: 'binding missing',
    })
  })

  it('reports successful OCR self-checks', async () => {
    const result = await checkImageOcrAvailability('/tmp/logo.png', {
      platform: 'win32',
      async loadLocalOcr() {
        return {
          OcrAccuracy: { Fast: 0, Accurate: 1 },
          async recognize(imagePath, accuracy, languages) {
            expect(imagePath).toBe('/tmp/logo.png')
            expect(accuracy).toBe(1)
            expect(languages).toEqual(['en-US'])
            return { text: 'aiex', confidence: 0.94 }
          },
        }
      },
    })

    expect(result).toEqual({
      platformSupported: true,
      dependencyLoaded: true,
      ocrOk: true,
      imagePath: '/tmp/logo.png',
      recognizedText: 'aiex',
      confidence: 0.94,
      error: undefined,
    })
  })

  it('reports OCR self-check recognition mismatches', async () => {
    const result = await checkImageOcrAvailability('/tmp/logo.png', {
      platform: 'darwin',
      async loadLocalOcr() {
        return {
          OcrAccuracy: { Fast: 0, Accurate: 1 },
          async recognize() {
            return { text: 'wrong text', confidence: 0.52 }
          },
        }
      },
    })

    expect(result.ocrOk).toBe(false)
    expect(result.dependencyLoaded).toBe(true)
    expect(result.error).toContain('Expected OCR text')
  })
})
