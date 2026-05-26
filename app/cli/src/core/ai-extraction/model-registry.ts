import type { RegistryEntry } from '@/types'
import capabilities from './model-capabilities.json'

const registry = capabilities as Record<string, RegistryEntry>

function normalize(name: string): string {
  return name.toLowerCase().replace(/[-_. ]/g, '')
}

const normalizedCache = new Map<string, string>()
function buildNormalizedCache(): void {
  if (normalizedCache.size > 0)
    return
  for (const key of Object.keys(registry)) {
    const nk = normalize(key)
    if (!normalizedCache.has(nk)) {
      normalizedCache.set(nk, key)
    }
  }
}

export function lookupModel(name: string): RegistryEntry | null {
  const exact = registry[name]
  if (exact)
    return { ...exact }

  // Try normalized match (strip separators, lowercase)
  buildNormalizedCache()
  const nk = normalize(name)
  const matched = normalizedCache.get(nk)
  if (matched) {
    const entry = registry[matched]
    return entry ? { ...entry } : null
  }

  return null
}

export function getRegistrySize(): number {
  return Object.keys(registry).length
}
