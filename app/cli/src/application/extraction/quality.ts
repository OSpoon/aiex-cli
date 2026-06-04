import type { ExtractionFailureStage } from '@/domain/audit/types'
import type { ExtractionQualityMetrics } from '@/domain/extraction/quality'
import type { InputProcessingInfo } from '@/domain/input/types'

export function formatInputProcessing(input: InputProcessingInfo): string {
  const handler = input.converter ? `${input.handler}(${input.converter})` : input.handler
  return `${input.mime ?? input.kind} -> ${handler}`
}

export function mergeQuality(
  inputQuality: ExtractionQualityMetrics | undefined,
  aiQuality: ExtractionQualityMetrics | undefined,
): ExtractionQualityMetrics | undefined {
  if (!inputQuality && !aiQuality)
    return undefined
  return {
    input: inputQuality?.input,
    ai: aiQuality?.ai,
  }
}

export function classifyInputError(error: unknown, inputProcessing?: InputProcessingInfo): ExtractionFailureStage {
  if (inputProcessing?.handler === 'pdf_converter')
    return 'file_conversion'
  if (inputProcessing?.handler === 'image_local_ocr')
    return 'ocr'

  const message = (error instanceof Error ? error.message : String(error)).toLowerCase()
  if (message.includes('ocr'))
    return 'ocr'
  if (message.includes('pdf') || message.includes('converter'))
    return 'file_conversion'
  return 'input_detection'
}

export function qualityGateError(quality?: ExtractionQualityMetrics): string | null {
  const invalidEvidenceFields = quality?.ai?.evidence?.invalidFields ?? []
  if (invalidEvidenceFields.length > 0)
    return `Evidence mismatch for field(s): ${invalidEvidenceFields.join(', ')}`
  return null
}
