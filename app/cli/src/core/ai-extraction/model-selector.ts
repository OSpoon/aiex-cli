import type { AIModelConfig, SelectedModel, SelectModelInput } from '@/types'
import { t } from '@/locales'

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
  const { models, inputTokens, outputTokens } = input

  if (models.length === 0) {
    throw new Error(t('errors.ai.noModels'))
  }

  let candidates = filterCompatible(models, inputTokens, outputTokens)
  if (candidates.length === 0) {
    candidates = models
  }

  const soModel = candidates.find(m => m.capabilities.structuredOutput)
  if (soModel) {
    return { name: soModel.name, capabilities: soModel.capabilities }
  }

  return { name: candidates[0].name, capabilities: candidates[0].capabilities }
}
