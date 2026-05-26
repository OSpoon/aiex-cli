import type { ModelCapabilities } from '@/types'
import { lookupModel } from './model-registry'

export function lookupModelCapabilities(modelName: string): ModelCapabilities | null {
  const entry = lookupModel(modelName)
  if (entry)
    return { ...entry }
  return null
}
