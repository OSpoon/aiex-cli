export async function listSchemas(): Promise<string[]> {
  const res = await fetch('/api/schema')
  if (!res.ok) {
    throw new Error('Failed to list schemas')
  }
  return res.json() as Promise<string[]>
}

export async function getSchema(name: string): Promise<unknown> {
  const res = await fetch(`/api/schema/${encodeURIComponent(name)}`)
  if (!res.ok) {
    throw new Error(`Failed to get schema: ${name}`)
  }
  return res.json()
}

export async function saveSchema(name: string, schema: unknown): Promise<void> {
  const res = await fetch(`/api/schema/${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(schema, null, 2),
  })
  if (!res.ok) {
    throw new Error(`Failed to save schema: ${name}`)
  }
}

export async function deleteSchema(name: string): Promise<void> {
  const res = await fetch(`/api/schema/${encodeURIComponent(name)}`, {
    method: 'DELETE',
  })
  if (!res.ok) {
    throw new Error(`Failed to delete schema: ${name}`)
  }
}

export interface MigrateResult {
  success: boolean
  changes: number
  tables: number
  relations: number
  tag?: string
  error?: string
  warnings?: string[]
}

export async function migrateSchema(): Promise<MigrateResult> {
  const res = await fetch('/api/migrate', { method: 'POST' })
  const data = await res.json() as MigrateResult
  if (!res.ok || !data.success) {
    throw new Error(data.error || 'Migration failed')
  }
  return data
}

// Prompt Snapshot API

export interface PromptSnapshotResult {
  success: boolean
  content?: string
  error?: string
}

export async function getPromptSnapshot(tableName: string): Promise<PromptSnapshotResult> {
  const res = await fetch(`/api/prompt-snapshot/${encodeURIComponent(tableName)}`)
  return res.json() as Promise<PromptSnapshotResult>
}

// AI Configuration API

export interface AIModelConfig {
  name: string
  capabilities: {
    vision: boolean
    structuredOutput: boolean
  }
}

export interface AIProviderConfig {
  baseURL: string
  apiKey: string
  models: AIModelConfig[]
}

export interface ModelCapabilities {
  structuredOutput: boolean
  vision: boolean
}

export interface PromptConfig {
  systemTemplate: string
  userTemplate: string
}

export interface ExtractionConfig {
  outputDir: string
}

export interface AIConfig {
  provider: AIProviderConfig
  prompt: PromptConfig
  extraction: ExtractionConfig
}

export async function getAIConfig(): Promise<AIConfig> {
  const res = await fetch('/api/ai/config')
  if (!res.ok) {
    throw new Error('Failed to get AI config')
  }
  return res.json() as Promise<AIConfig>
}

export async function saveAIConfig(config: AIConfig): Promise<void> {
  const res = await fetch('/api/ai/config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config, null, 2),
  })
  if (!res.ok) {
    const data = await res.json() as { error?: string }
    throw new Error(data.error || 'Failed to save AI config')
  }
}

export async function registryLookup(modelName: string): Promise<ModelCapabilities | null> {
  const res = await fetch('/api/ai/registry-lookup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ modelName }),
  })
  if (!res.ok) return null
  const data = await res.json()
  if (!data || typeof data.vision !== 'boolean') return null
  return data as ModelCapabilities
}

// Data Browser API

export interface ExtractionRecord {
  name: string
  schemaName: string
  timestamp: string
  fileSize: number
  modifiedAt: string
}

export async function listExtractions(): Promise<ExtractionRecord[]> {
  const res = await fetch('/api/data')
  if (!res.ok) {
    throw new Error('Failed to list extractions')
  }
  return res.json() as Promise<ExtractionRecord[]>
}

export interface ExtractionDetail {
  success: boolean
  content?: string
  name?: string
  error?: string
}

export async function getExtraction(name: string): Promise<ExtractionDetail> {
  const res = await fetch(`/api/data/${encodeURIComponent(name)}`)
  return res.json() as Promise<ExtractionDetail>
}


