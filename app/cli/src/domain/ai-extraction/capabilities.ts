import { lookupModel } from './model-registry'

export interface ModelCapabilities {
  structuredOutput: boolean
  vision: boolean
  maxTokens?: number
  maxOutputTokens?: number
}

export function lookupModelCapabilities(modelName: string): ModelCapabilities | null {
  const entry = lookupModel(modelName)
  if (entry)
    return { ...entry }
  return null
}
