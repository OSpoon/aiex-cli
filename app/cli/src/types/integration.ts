export interface NotionWriteResult {
  pageId: string
  databaseId: string
  dataSourceId?: string
}

export interface NotionSchemaField {
  name: string
  title?: string
  description?: string
}

export interface NotionDatabaseProperty {
  name: string
  type: string
}

export interface NotionDatabaseInfo {
  databaseId: string
  dataSourceId?: string
  titleProperty?: string
  properties: NotionDatabaseProperty[]
  suggestedFieldMap: Record<string, string>
}

export interface WebhookPayload {
  event: 'extraction.success' | 'extraction.failed'
  schemaName: string
  auditId: string
  timestamp: string
  source: {
    type: 'file' | 'text'
    fileName?: string
    filePath?: string
  }
  data?: unknown
  error?: string
  tokensUsed?: {
    prompt: number
    completion: number
    total: number
  }
}
