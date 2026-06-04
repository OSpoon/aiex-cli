import type { ExtractionAuditRecord } from '@/domain/audit/types'
import type { DatabaseTableColumn } from '@/domain/database'
import type { MigrationConfig } from '@/domain/schema/types'
import fs from 'node:fs/promises'
import path from 'node:path'
import { readFile as readJsonFile } from 'jsonfile'
import { readAIConfig } from '@/infrastructure/ai/ai-config-store'
import {
  createExtractionAuditRecord,
  listExtractionAuditRecords,
  updateExtractionAuditRecord,
} from '@/infrastructure/audit/file-audit-store'
import { createProjectDatabase } from '@/infrastructure/database/sqlite-database'
import { writeNotionPage } from '@/infrastructure/integrations/notion-sink'
import { t } from '@/locales'

const FILE_REGEX = /\.json$/
const EXTRACTION_TIMESTAMP_RE = /-\d{4}-\d{2}-\d{2}T/
const TIMESTAMP_CLEANUP = /(\d{2})-(\d{2})-(\d{2})/
const TIMESTAMP_TZ = /(\d{3})Z/

export interface ExtractionRecord {
  name: string
  schemaName: string
  timestamp: string
  fileSize: number
  modifiedAt: string
  notionStatus: 'synced' | 'failed' | 'not_synced'
  notionPages?: Array<{ databaseId: string, pageId: string }>
  notionError?: string
  inputProcessing?: ExtractionAuditRecord['inputProcessing']
  quality?: ExtractionAuditRecord['quality']
  failureStage?: ExtractionAuditRecord['failureStage']
}

export interface RowExtractionAction {
  extractionName: string
  notionStatus: 'synced' | 'failed' | 'not_synced'
  notionPages?: Array<{ databaseId: string, pageId: string }>
  notionError?: string
}

export type TableColumn = DatabaseTableColumn

export function schemaNameFromExtractionFile(name: string): string | null {
  const stem = name.replace(FILE_REGEX, '')
  const match = stem.match(EXTRACTION_TIMESTAMP_RE)
  if (!match || typeof match.index !== 'number' || match.index <= 0)
    return null
  return stem.slice(0, match.index)
}

function getAuditNotionStatus(record: Awaited<ReturnType<typeof listExtractionAuditRecords>>[number]): RowExtractionAction['notionStatus'] {
  if (record.notionPages?.length)
    return 'synced'
  if (record.status === 'failed')
    return 'failed'
  return 'not_synced'
}

async function getRowExtractionActions(aiexDir: string, tableName: string): Promise<Map<string, RowExtractionAction>> {
  const actions = new Map<string, RowExtractionAction>()
  const auditRecords = await listExtractionAuditRecords(aiexDir)

  for (const record of auditRecords) {
    if (!record.outputName)
      continue

    for (const inserted of record.tablesInserted ?? []) {
      if (inserted.table !== tableName)
        continue

      const key = String(inserted.rowId)
      if (actions.has(key))
        continue

      const notionPages = record.notionPages?.length ? record.notionPages : undefined
      actions.set(key, {
        extractionName: record.outputName,
        notionStatus: getAuditNotionStatus(record),
        notionPages,
        notionError: !notionPages && record.status === 'failed' ? record.error : undefined,
      })
    }
  }

  return actions
}

export async function listExtractions(config: MigrationConfig): Promise<ExtractionRecord[]> {
  const aiexDir = path.dirname(config.schemaPath)
  const extractedDir = path.join(aiexDir, 'extracted')

  await fs.mkdir(extractedDir, { recursive: true })
  const files = await fs.readdir(extractedDir)
  const jsonFiles = files.filter(f => f.endsWith('.json') && !f.endsWith('.prompt.md'))
  const auditRecords = await listExtractionAuditRecords(aiexDir)
  const auditByOutputName = new Map(auditRecords.map(record => [record.outputName, record]))

  const records: ExtractionRecord[] = []

  for (const file of jsonFiles) {
    const schemaName = schemaNameFromExtractionFile(file)
    if (!schemaName)
      continue

    const rawTimestamp = file
      .replace(FILE_REGEX, '')
      .slice(schemaName.length + 1)
    const timestamp = rawTimestamp
      .replace(/-/g, (d: string, i: number) => (i === 4 || i === 7) ? '-' : d)
      .replace(TIMESTAMP_CLEANUP, (_, h, m, s) => `${h}:${m}:${s}`)
      .replace(TIMESTAMP_TZ, '.$1Z')

    const filePath = path.join(extractedDir, file)
    try {
      const stat = await fs.stat(filePath)
      const audit = auditByOutputName.get(file)
      const notionPages = audit?.notionPages?.length ? audit.notionPages : undefined
      records.push({
        name: file,
        schemaName,
        timestamp,
        fileSize: stat.size,
        modifiedAt: stat.mtime.toISOString(),
        notionStatus: notionPages ? 'synced' : audit?.status === 'failed' ? 'failed' : 'not_synced',
        notionPages,
        notionError: !notionPages && audit?.status === 'failed' ? audit.error : undefined,
        inputProcessing: audit?.inputProcessing,
        quality: audit?.quality,
        failureStage: audit?.failureStage,
      })
    }
    catch {
      continue
    }
  }

  records.sort((a, b) => b.timestamp.localeCompare(a.timestamp))
  return records
}

export async function listTables(config: MigrationConfig): Promise<Array<{ name: string, title: string, hasData: boolean }>> {
  const schemaDir = config.schemaPath
  let schemaFiles: string[] = []
  try {
    schemaFiles = (await fs.readdir(schemaDir)).filter(f => f.endsWith('.json'))
  }
  catch {
    schemaFiles = []
  }

  let dbTables: string[] = []
  try {
    dbTables = await createProjectDatabase(config).listTableNames()
  }
  catch {
    // db not ready
  }

  const tables: Array<{ name: string, title: string, hasData: boolean }> = []

  for (const file of schemaFiles) {
    try {
      const schema = await readJsonFile(path.join(schemaDir, file))
      const tableName = schema.table?.name

      if (!tableName)
        continue

      tables.push({
        name: tableName,
        title: schema.title || tableName,
        hasData: dbTables.includes(tableName),
      })
    }
    catch {
      continue
    }
  }

  return tables
}

export interface TableDataResult {
  columns: TableColumn[]
  rows: any[]
  rowActions: Record<string, RowExtractionAction>
  total: number
  page: number
  pageSize: number
  totalPages: number
  schema: any
}

export async function getTableData(
  config: MigrationConfig,
  tableName: string,
  query: {
    page: number
    pageSize: number
    search: string
    sortField?: string
    sortOrder: 'asc' | 'desc'
    all: boolean
  },
): Promise<TableDataResult> {
  const { page, pageSize, search, sortField, sortOrder, all } = query
  const aiexDir = path.dirname(config.schemaPath)

  const database = createProjectDatabase(config)
  if (!(await database.exists()))
    throw new Error(t('server.dbNotFound'))

  try {
    const tableRows = await database.readTableRows({
      tableName,
      page,
      pageSize,
      search,
      sortField,
      sortOrder,
      all,
    }).catch((error) => {
      if (error instanceof Error && error.message === `Table not found: ${tableName}`)
        throw new Error(t('server.tableNotFound', { name: tableName }))
      throw error
    })

    const actionsByRowId = await getRowExtractionActions(aiexDir, tableName)
    const rowActions = Object.fromEntries(
      tableRows.rowIds
        .map((rowId, index) => {
          const action = rowId === undefined ? undefined : actionsByRowId.get(rowId)
          return action ? [String(index), action] : null
        })
        .filter((entry): entry is [string, RowExtractionAction] => !!entry),
    )

    // Find schema file corresponding to this table
    const schemaDir = config.schemaPath
    let schema: any = null
    try {
      const schemaFiles = (await fs.readdir(schemaDir)).filter(f => f.endsWith('.json'))
      for (const file of schemaFiles) {
        const s = await readJsonFile(path.join(schemaDir, file))
        if (s.table?.name === tableName) {
          schema = s
          break
        }
      }
    }
    catch {}

    return {
      columns: tableRows.columns,
      rows: tableRows.rows,
      rowActions,
      total: tableRows.total,
      page: tableRows.page,
      pageSize: all ? tableRows.total : tableRows.pageSize,
      totalPages: tableRows.totalPages,
      schema,
    }
  }
  catch (error) {
    if (error instanceof Error)
      throw error
    throw new Error(String(error))
  }
}

export async function retryNotionSync(
  config: MigrationConfig,
  fileName: string,
): Promise<{ success: boolean, notionPages: Array<{ databaseId: string, pageId: string }> }> {
  const aiexDir = path.dirname(config.schemaPath)
  const extractedDir = path.join(aiexDir, 'extracted')
  const filePath = path.join(extractedDir, fileName)
  const schemaName = schemaNameFromExtractionFile(fileName)
  if (!schemaName)
    throw new Error(t('server.cannotInferSchema'))

  const aiConfig = await readAIConfig(aiexDir)
  if (!aiConfig?.notion?.enabled)
    throw new Error(t('errors.notion.notEnabled'))
  if (!aiConfig.notion.schemas?.[schemaName]?.databaseId?.trim())
    throw new Error(t('errors.notion.noSchemaConfig', { name: schemaName }))

  try {
    const data = await readJsonFile(filePath) as unknown
    if (!data || typeof data !== 'object' || Array.isArray(data))
      throw new Error(t('errors.ai.extractionNotObject'))

    const page = await writeNotionPage(aiConfig.notion, schemaName, data as Record<string, unknown>)
    const notionPages = [{ databaseId: page.databaseId, pageId: page.pageId }]
    const records = await listExtractionAuditRecords(aiexDir)
    let record = records.find(record => record.outputName === fileName)
    if (!record) {
      record = await createExtractionAuditRecord(aiexDir, {
        schemaName,
        source: { type: 'file', filePath, fileName },
      })
    }
    if (record) {
      await updateExtractionAuditRecord(aiexDir, record.id, {
        status: 'succeeded',
        outputPath: filePath,
        outputName: fileName,
        notionPages,
        error: undefined,
      })
    }

    return { success: true, notionPages }
  }
  catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    const records = await listExtractionAuditRecords(aiexDir)
    const record = records.find(record => record.outputName === fileName)
    if (record) {
      await updateExtractionAuditRecord(aiexDir, record.id, {
        status: 'failed',
        outputPath: filePath,
        outputName: fileName,
        error: message,
      })
    }
    throw error
  }
}
