import type { AIConfig, AIModelConfig, ImageOcrConfig } from '@/core/ai-extraction/types'
import process from 'node:process'
import { t } from '@/locales'

type LocalOcr = typeof import('@napi-rs/system-ocr')

export interface ImageOcrRuntime {
  platform: NodeJS.Platform
  loadLocalOcr: () => Promise<LocalOcr>
}

export interface ImageOcrTextResult {
  text: string
  confidence: number
}

export interface ImageOcrSelfCheckResult {
  platformSupported: boolean
  dependencyLoaded: boolean
  ocrOk: boolean | null
  imagePath?: string
  recognizedText?: string
  confidence?: number
  error?: string
}

const DEFAULT_OCR_LANGUAGES = 'en-US, zh-Hans'
const SELF_CHECK_EXPECTED_TEXT = 'AIEX'

const defaultRuntime: ImageOcrRuntime = {
  platform: process.platform,
  async loadLocalOcr() {
    const mod = await import('@napi-rs/system-ocr')
    return mod
  },
}

function imageOcrMode(config?: ImageOcrConfig): NonNullable<ImageOcrConfig['ocrFallback']> {
  return config?.ocrFallback ?? 'auto'
}

function hasVisionModel(aiConfig?: AIConfig, modelOverride?: AIModelConfig): boolean {
  if (modelOverride)
    return modelOverride.capabilities.vision
  return aiConfig?.provider.models.some(model => model.capabilities.vision) ?? true
}

export function shouldUseImageOcrFallback(
  aiConfig?: AIConfig,
  modelOverride?: AIModelConfig,
  runtime: Pick<ImageOcrRuntime, 'platform'> = defaultRuntime,
): boolean {
  if (hasVisionModel(aiConfig, modelOverride))
    return false

  const mode = imageOcrMode(aiConfig?.image)
  if (mode === 'off')
    return false
  if (mode === 'local')
    return true
  return isLocalOcrPlatform(runtime.platform)
}

function isLocalOcrPlatform(platform: NodeJS.Platform): boolean {
  return platform === 'darwin' || platform === 'win32'
}

function parseOcrLanguages(languages?: string): string[] {
  return (languages ?? DEFAULT_OCR_LANGUAGES)
    .split(',')
    .map(language => language.trim())
    .filter(Boolean)
}

export async function recognizeImageText(
  imagePath: string,
  config?: ImageOcrConfig,
  runtime: ImageOcrRuntime = defaultRuntime,
): Promise<ImageOcrTextResult> {
  const mode = imageOcrMode(config)
  if (!isLocalOcrPlatform(runtime.platform)) {
    throw new Error(t('errors.ocr.platformUnsupported', { platform: runtime.platform }))
  }
  if (mode === 'off') {
    throw new Error(t('errors.ocr.disabled'))
  }

  let localOcr: LocalOcr
  try {
    localOcr = await runtime.loadLocalOcr()
  }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(t('errors.ocr.unavailable', { error: message }))
  }

  const result = await localOcr.recognize(
    imagePath,
    localOcr.OcrAccuracy.Accurate,
    parseOcrLanguages(config?.ocrLanguages),
  )

  const text = result.text.trim()
  if (!text)
    throw new Error(t('errors.ocr.noText'))

  const confidence = result.confidence
  const minConfidence = config?.ocrMinConfidence ?? 0
  if (confidence < minConfidence)
    throw new Error(t('errors.ocr.lowConfidence', { confidence: (confidence * 100).toFixed(1), min: (minConfidence * 100).toFixed(1) }))

  return {
    text,
    confidence,
  }
}

function normalizeOcrText(text: string): string {
  return text.replace(/\s+/g, '').trim().toUpperCase()
}

export async function checkImageOcrAvailability(
  imagePath?: string,
  runtime: ImageOcrRuntime = defaultRuntime,
): Promise<ImageOcrSelfCheckResult> {
  if (!isLocalOcrPlatform(runtime.platform)) {
    return {
      platformSupported: false,
      dependencyLoaded: false,
      ocrOk: null,
      imagePath,
      error: t('errors.ocr.platformUnsupported', { platform: runtime.platform }),
    }
  }

  let localOcr: LocalOcr
  try {
    localOcr = await runtime.loadLocalOcr()
  }
  catch (error) {
    return {
      platformSupported: true,
      dependencyLoaded: false,
      ocrOk: null,
      imagePath,
      error: error instanceof Error ? error.message : String(error),
    }
  }

  if (!imagePath) {
    return {
      platformSupported: true,
      dependencyLoaded: true,
      ocrOk: null,
      error: 'No OCR self-check image was found.',
    }
  }

  try {
    const result = await localOcr.recognize(imagePath, localOcr.OcrAccuracy.Accurate, ['en-US'])
    const recognizedText = result.text.trim()
    const ocrOk = normalizeOcrText(recognizedText).includes(SELF_CHECK_EXPECTED_TEXT)
    return {
      platformSupported: true,
      dependencyLoaded: true,
      ocrOk,
      imagePath,
      recognizedText,
      confidence: result.confidence,
      error: ocrOk ? undefined : `Expected OCR text "${SELF_CHECK_EXPECTED_TEXT}" was not recognized.`,
    }
  }
  catch (error) {
    return {
      platformSupported: true,
      dependencyLoaded: true,
      ocrOk: false,
      imagePath,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
