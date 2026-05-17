import type { AIModelConfig } from './types'

export interface SelectModelInput {
  models: AIModelConfig[]
  isImage: boolean
  fileName?: string
  inputTokens?: number
  outputTokens?: number
}

export interface SelectedModel {
  name: string
  capabilities: AIModelConfig['capabilities']
}

function filterCompatible(models: AIModelConfig[], inputTokens?: number, outputTokens?: number): AIModelConfig[] {
  return models.filter((m) => {
    if (inputTokens && m.capabilities.maxTokens && m.capabilities.maxTokens < inputTokens) {
      return false
    }
    if (outputTokens && m.capabilities.maxOutputTokens && m.capabilities.maxOutputTokens < outputTokens) {
      return false
    }
    return true
  })
}

export function selectModel(input: SelectModelInput): SelectedModel {
  const { models, isImage, fileName, inputTokens, outputTokens } = input

  if (models.length === 0) {
    throw new Error('No AI models configured. Please add at least one model in AI Settings.')
  }

  let candidates = filterCompatible(models, inputTokens, outputTokens)
  if (candidates.length === 0) {
    candidates = models
  }

  if (isImage) {
    const visionModel = candidates.find(m => m.capabilities.vision)
    if (!visionModel) {
      const hint = fileName ? ` (${fileName})` : ''
      const msg = inputTokens
        ? `No vision-capable model with sufficient context window (≥${inputTokens} tokens) found${hint}.`
        : `Image input requires a model with vision capability${hint}.`
      throw new Error(
        `${msg} Please add a suitable vision-capable model in AI Settings.`,
      )
    }
    return { name: visionModel.name, capabilities: visionModel.capabilities }
  }

  const soModel = candidates.find(m => m.capabilities.structuredOutput)
  if (soModel) {
    return { name: soModel.name, capabilities: soModel.capabilities }
  }

  return { name: candidates[0].name, capabilities: candidates[0].capabilities }
}
