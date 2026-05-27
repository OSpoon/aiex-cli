export interface ExtractionWebhookSource {
  type: 'file' | 'text'
  filePath?: string
}

export type ExtractionWebhookEvent = 'extraction.success' | 'extraction.failed'

export interface ExtractionTokensUsed {
  prompt: number
  completion: number
  total: number
}

export interface NotionSyncPage {
  databaseId: string
  pageId: string
}
