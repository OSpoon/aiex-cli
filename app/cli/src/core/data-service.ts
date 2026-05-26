import type { ExtractionRecord, MigrationConfig, RowExtractionAction, SqliteTableInfoRow, TableColumn, TableDataResult } from '@/types'
import fs from 'node:fs/promises'
import path from 'node:path'
import Database from 'better-sqlite3'
import { readFile as readJsonFile } from 'jsonfile'
import { Kysely, sql, SqliteDialect } from 'kysely'
import { readAIConfig } from '@/core/ai-extraction/config'
import {
  createExtractionAuditRecord,
  listExtractionAuditRecords,
  updateExtractionAuditRecord,
} from '@/core/extraction-audit'
import { writeNotionPage } from '@/core/notion-sink'
import { t } from '@/locales'

const FILE_REGEX = /\.json$/
const EVIDENCE_FILE_SUFFIX = '.evidence.json'
const EXTRACTION_TIMESTAMP_RE = /-\d{4}-\d{2}-\d{2}T/
const INTERNAL_ROWID_COLUMN = '__aiex_rowid'
const TIMESTAMP_CLEANUP = /(\d{2})-(\d{2})-(\d{2})/
const TIMESTAMP_TZ = /(\d{3})Z/

type DynamicDatabase = Record<string, Record<string, unknown>>

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

async function readEvidenceSummary(extractedDir: string, outputName: string): Promise<ExtractionRecord['evidenceSummary'] | undefined> {
  const evidencePath = path.join(extractedDir, outputName.replace(FILE_REGEX, EVIDENCE_FILE_SUFFIX))
  try {
    const evidence = await readJsonFile(evidencePath) as any
    const coverage = evidence?.coverage
    if (!coverage || typeof coverage !== 'object')
      return undefined

    return {
      path: evidencePath,
      fieldCount: Number(coverage.fieldCount) || 0,
      evidenceCount: Number(coverage.evidenceCount) || 0,
      foundCount: Number(coverage.foundCount) || 0,
      missingCount: Number(coverage.missingCount) || 0,
      inferredCount: Number(coverage.inferredCount) || 0,
      issueCount: Number(coverage.issueCount) || 0,
    }
  }
  catch {
    return undefined
  }
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

function createReadonlyQueryDb(databasePath: string): Kysely<DynamicDatabase> {
  return new Kysely<DynamicDatabase>({
    dialect: new SqliteDialect({
      database: new Database(databasePath, { readonly: true }),
    }),
  })
}

export async function listExtractions(config: MigrationConfig): Promise<ExtractionRecord[]> {
  const aiexDir = path.dirname(config.schemaPath)
  const extractedDir = path.join(aiexDir, 'extracted')

  await fs.mkdir(extractedDir, { recursive: true })
  const files = await fs.readdir(extractedDir)
  const jsonFiles = files.filter(f =>
    f.endsWith('.json')
    && !f.endsWith('.prompt.md')
    && !f.endsWith(EVIDENCE_FILE_SUFFIX),
  )
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
        evidenceSummary: await readEvidenceSummary(extractedDir, file),
        notionStatus: notionPages ? 'synced' : audit?.status === 'failed' ? 'failed' : 'not_synced',
        notionPages,
        notionError: !notionPages && audit?.status === 'failed' ? audit.error : undefined,
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

  let db: Kysely<DynamicDatabase> | null = null
  let dbTables: string[] = []
  try {
    db = createReadonlyQueryDb(config.databasePath)
    const tablesResult = await sql<{ name: string }>`
      select name
      from sqlite_master
      where type = 'table' and name not like 'sqlite_%' and name not like '_%'
      order by name
    `.execute(db)
    dbTables = tablesResult.rows.map(row => row.name)
  }
  catch {
    // db not ready
  }
  finally {
    await db?.destroy()
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

  let db: Kysely<DynamicDatabase>
  try {
    db = createReadonlyQueryDb(config.databasePath)
  }
  catch {
    throw new Error(t('server.dbNotFound'))
  }

  try {
    const tableExists = await sql<{ name: string }>`
      select name
      from sqlite_master
      where type = 'table' and name = ${tableName}
    `.execute(db)

    if (tableExists.rows.length === 0)
      throw new Error(t('server.tableNotFound', { name: tableName }))

    const tableInfo = await sql<SqliteTableInfoRow>`
      pragma table_info(${sql.table(tableName)})
    `.execute(db)

    const columns: TableColumn[] = tableInfo.rows.map(col => ({
      name: col.name,
      type: col.type,
      notNull: !!col.notnull,
      pk: !!col.pk,
    }))

    const searchConditions = columns.map(col => sql`${sql.ref(col.name)} like ${`%${search}%`}`)
    const searchCondition = search
      ? sql`where ${sql.join(searchConditions, sql` or `)}`
      : sql``

    const sortColumn = columns.find(col => col.name === sortField)
    const orderBy = sortColumn
      ? sql`order by ${sql.ref(sortColumn.name)} ${sql.raw(sortOrder === 'desc' ? 'desc' : 'asc')}`
      : sql``

    const countResult = await sql<{ count: number }>`
      select count(*) as count
      from ${sql.table(tableName)}
      ${searchCondition}
    `.execute(db)
    const total = countResult.rows[0]?.count ?? 0

    const offset = (page - 1) * pageSize
    const totalPages = all ? 1 : Math.max(1, Math.ceil(total / pageSize))

    const result = all
      ? await sql<Record<string, unknown>>`
          select rowid as ${sql.raw(INTERNAL_ROWID_COLUMN)}, *
          from ${sql.table(tableName)}
          ${searchCondition}
          ${orderBy}
        `.execute(db)
      : await sql<Record<string, unknown>>`
          select rowid as ${sql.raw(INTERNAL_ROWID_COLUMN)}, *
          from ${sql.table(tableName)}
          ${searchCondition}
          ${orderBy}
          limit ${pageSize}
          offset ${offset}
        `.execute(db)

    const actionsByRowId = await getRowExtractionActions(aiexDir, tableName)
    const rowActions = Object.fromEntries(
      result.rows
        .map((row, index) => {
          const rowId = row[INTERNAL_ROWID_COLUMN]
          const action = rowId === null || rowId === undefined ? undefined : actionsByRowId.get(String(rowId))
          return action ? [String(index), action] : null
        })
        .filter((entry): entry is [string, RowExtractionAction] => !!entry),
    )
    const rows = result.rows.map(({ [INTERNAL_ROWID_COLUMN]: _rowid, ...row }) => row)

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
      columns,
      rows,
      rowActions,
      total,
      page: all ? 1 : page,
      pageSize: all ? total : pageSize,
      totalPages,
      schema,
    }
  }
  finally {
    await db.destroy()
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
