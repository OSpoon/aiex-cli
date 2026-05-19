import ky, { HTTPError } from 'ky'

const api = ky.create({
  retry: 0,
})

async function getErrorMessage(error: unknown, fallback: string): Promise<string> {
  if (error instanceof HTTPError) {
    try {
      const data = await error.response.json() as { error?: string }
      return data.error || fallback
    }
    catch {
      return fallback
    }
  }

  return error instanceof Error ? error.message : fallback
}

export async function listSchemas(): Promise<string[]> {
  return api.get('api/schema').json<string[]>()
}

export async function getSchema(name: string): Promise<unknown> {
  return api.get(`api/schema/${encodeURIComponent(name)}`).json()
}

export async function saveSchema(name: string, schema: unknown): Promise<void> {
  try {
    await api.post(`api/schema/${encodeURIComponent(name)}`, { json: schema })
  }
  catch (error) {
    throw new Error(await getErrorMessage(error, `Failed to save schema: ${name}`))
  }
}

export async function deleteSchema(name: string): Promise<void> {
  try {
    await api.delete(`api/schema/${encodeURIComponent(name)}`)
  }
  catch (error) {
    throw new Error(await getErrorMessage(error, `Failed to delete schema: ${name}`))
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
  const data = await api.post('api/migrate').json<MigrateResult>()
  if (!data.success) {
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
  return api.get(`api/prompt-snapshot/${encodeURIComponent(tableName)}`).json<PromptSnapshotResult>()
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
  timeout?: number
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

export type PdfConverterKind = "unpdf" | "mineru" | "external"

export interface ExternalPdfConverterConfig {
  command: string
  args: string[]
  outputFile?: string
  timeout?: number
  fallbackToUnpdf?: boolean
  keepOutput?: boolean
}

export interface PdfConfig {
  converter: PdfConverterKind
  mineru?: ExternalPdfConverterConfig
  external?: ExternalPdfConverterConfig
}

export interface LangfuseConfig {
  publicKey: string
  secretKey: string
  host?: string
}

export interface AIConfig {
  provider: AIProviderConfig
  prompt: PromptConfig
  extraction: ExtractionConfig
  pdf?: PdfConfig
  langfuse?: LangfuseConfig
}

export async function getAIConfig(): Promise<AIConfig> {
  return api.get('api/ai/config').json<AIConfig>()
}

export async function saveAIConfig(config: AIConfig): Promise<void> {
  try {
    await api.put('api/ai/config', { json: config })
  }
  catch (error) {
    throw new Error(await getErrorMessage(error, 'Failed to save AI config'))
  }
}

export async function registryLookup(modelName: string): Promise<ModelCapabilities | null> {
  const data = await api.post('api/ai/registry-lookup', { json: { modelName } }).json<Partial<ModelCapabilities>>().catch(() => null)
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

export interface ColumnInfo {
  name: string
  type: string
  notNull: boolean
  pk: boolean
}

export interface TableData {
  columns: ColumnInfo[]
  rows: Record<string, unknown>[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

export interface TableInfo {
  name: string
  title: string
  hasData: boolean
}

export interface TableDataParams {
  page?: number
  pageSize?: number
  search?: string
  sortField?: string
  sortOrder?: string
}

export async function listExtractions(): Promise<ExtractionRecord[]> {
  return api.get('api/data').json<ExtractionRecord[]>()
}

export async function listDataTables(): Promise<TableInfo[]> {
  return api.get('api/data/tables').json<TableInfo[]>()
}

export async function getTableData(tableName: string, params: TableDataParams = {}): Promise<TableData> {
  const searchParams = new URLSearchParams()
  if (params.page !== undefined)
    searchParams.set('page', String(params.page))
  if (params.pageSize !== undefined)
    searchParams.set('pageSize', String(params.pageSize))
  if (params.search)
    searchParams.set('search', params.search)
  if (params.sortField)
    searchParams.set('sortField', params.sortField)
  if (params.sortOrder)
    searchParams.set('sortOrder', params.sortOrder)

  return api.get(`api/data/tables/${encodeURIComponent(tableName)}`, { searchParams }).json<TableData>()
}

export interface ExtractionDetail {
  success: boolean
  content?: string
  name?: string
  error?: string
}

export async function getExtraction(name: string): Promise<ExtractionDetail> {
  return api.get(`api/data/${encodeURIComponent(name)}`).json<ExtractionDetail>()
}
