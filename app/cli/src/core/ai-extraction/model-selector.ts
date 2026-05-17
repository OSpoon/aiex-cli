import type { AIModelConfig } from './types'

export interface SelectModelInput {
  models: AIModelConfig[]
  isImage: boolean
  fileName?: string
}

export interface SelectedModel {
  name: string
  capabilities: AIModelConfig['capabilities']
}

export function selectModel(input: SelectModelInput): SelectedModel {
  const { models, isImage, fileName } = input

  if (models.length === 0) {
    throw new Error('No AI models configured. Please add at least one model in AI Settings.')
  }

  if (isImage) {
    const visionModel = models.find(m => m.capabilities.vision)
    if (!visionModel) {
      const hint = fileName ? ` (${fileName})` : ''
      throw new Error(
        `Image input requires a model with vision capability${hint}. `
        + 'Please add a vision-capable model (e.g. qwen-vl-plus) in AI Settings.',
      )
    }
    return { name: visionModel.name, capabilities: visionModel.capabilities }
  }

  const soModel = models.find(m => m.capabilities.structuredOutput)
  if (soModel) {
    return { name: soModel.name, capabilities: soModel.capabilities }
  }

  return { name: models[0].name, capabilities: models[0].capabilities }
}
