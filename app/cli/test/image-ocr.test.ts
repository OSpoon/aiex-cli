import { describe, expect, it } from 'vitest'
import { checkImageOcrAvailability, recognizeImageText, shouldUseImageOcrFallback } from '@/core/image-ocr'

const textModel = {
  name: 'text-model',
  capabilities: { vision: false, structuredOutput: true },
}

const visionModel = {
  name: 'vision-model',
  capabilities: { vision: true, structuredOutput: true },
}

const configWithoutVision = {
  provider: {
    baseURL: 'http://localhost:11434/v1',
    apiKey: 'test-key',
    models: [textModel],
  },
  prompt: {
    systemTemplate: 'Schema: {schema}',
    userTemplate: 'Text: {text}',
  },
  extraction: {
    outputDir: '.aiex/extracted',
  },
}

describe('image OCR fallback', () => {
  it('uses OCR fallback only when no vision model is available on supported platforms', () => {
    expect(shouldUseImageOcrFallback(configWithoutVision, undefined, { platform: 'darwin' })).toBe(true)
    expect(shouldUseImageOcrFallback(configWithoutVision, undefined, { platform: 'win32' })).toBe(true)
    expect(shouldUseImageOcrFallback({
      ...configWithoutVision,
      provider: { ...configWithoutVision.provider, models: [textModel, visionModel] },
    }, undefined, { platform: 'darwin' })).toBe(false)
  })

  it('does not use auto OCR fallback on unsupported platforms', () => {
    expect(shouldUseImageOcrFallback(configWithoutVision, undefined, { platform: 'linux' })).toBe(false)
  })

  it('allows local OCR to be required explicitly', () => {
    expect(shouldUseImageOcrFallback({
      ...configWithoutVision,
      image: { ocrFallback: 'local' },
    }, undefined, { platform: 'linux' })).toBe(true)
  })

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
