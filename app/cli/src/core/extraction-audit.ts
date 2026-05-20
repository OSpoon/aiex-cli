import fs from 'node:fs/promises'
import path from 'node:path'
import { readFile as readJsonFile, writeFile as writeJsonFile } from 'jsonfile'

const AUDIT_ID_RE = /^[\w.-]+$/

export type ExtractionAuditStatus = 'running' | 'succeeded' | 'failed'

export interface ExtractionAuditRecord {
  id: string
  status: ExtractionAuditStatus
  schemaName: string
  modelName?: string
  source: {
    type: 'text' | 'file'
    text?: string
    filePath?: string
    fileName?: string
  }
  retryOf?: string
  outputName?: string
  outputPath?: string
  tablesInserted?: Array<{ table: string, rowId: number }>
  tokensUsed?: {
    prompt: number
    completion: number
    total: number
  }
  error?: string
  createdAt: string
  updatedAt: string
}

export interface CreateExtractionAuditInput {
  schemaName: string
  modelName?: string
  source: ExtractionAuditRecord['source']
  retryOf?: string
}

function auditDir(aiexDir: string): string {
  return path.join(aiexDir, 'extracted', '_audit')
}

function auditPath(aiexDir: string, id: string): string {
  return path.join(auditDir(aiexDir), `${id}.json`)
}

function createAuditId(schemaName: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const suffix = Math.random().toString(36).slice(2, 8)
  return `${schemaName}-${timestamp}-${suffix}`
}

export async function createExtractionAuditRecord(
  aiexDir: string,
  input: CreateExtractionAuditInput,
): Promise<ExtractionAuditRecord> {
  const now = new Date().toISOString()
  const record: ExtractionAuditRecord = {
    id: createAuditId(input.schemaName),
    status: 'running',
    schemaName: input.schemaName,
    modelName: input.modelName || undefined,
    source: input.source,
    retryOf: input.retryOf,
    createdAt: now,
    updatedAt: now,
  }
  await fs.mkdir(auditDir(aiexDir), { recursive: true })
  await writeJsonFile(auditPath(aiexDir, record.id), record, { spaces: 2, EOL: '\n' })
  return record
}

export async function updateExtractionAuditRecord(
  aiexDir: string,
  id: string,
  patch: Partial<Omit<ExtractionAuditRecord, 'id' | 'createdAt'>>,
): Promise<ExtractionAuditRecord> {
  const current = await readExtractionAuditRecord(aiexDir, id)
  if (!current)
    throw new Error(`Extraction audit record not found: ${id}`)

  const record: ExtractionAuditRecord = {
    ...current,
    ...patch,
    source: patch.source ?? current.source,
    updatedAt: new Date().toISOString(),
  }
  await fs.mkdir(auditDir(aiexDir), { recursive: true })
  await writeJsonFile(auditPath(aiexDir, id), record, { spaces: 2, EOL: '\n' })
  return record
}

export async function readExtractionAuditRecord(
  aiexDir: string,
  id: string,
): Promise<ExtractionAuditRecord | null> {
  if (!AUDIT_ID_RE.test(id))
    return null

  try {
    return await readJsonFile(auditPath(aiexDir, id)) as ExtractionAuditRecord
  }
  catch {
    return null
  }
}

export async function listExtractionAuditRecords(aiexDir: string): Promise<ExtractionAuditRecord[]> {
  try {
    const dir = auditDir(aiexDir)
    const files = await fs.readdir(dir)
    const records = await Promise.all(
      files
        .filter(file => file.endsWith('.json'))
        .map(async (file) => {
          try {
            return await readJsonFile(path.join(dir, file)) as ExtractionAuditRecord
          }
          catch {
            return null
          }
        }),
    )
    return records
      .filter((record): record is ExtractionAuditRecord => !!record)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }
  catch {
    return []
  }
}
