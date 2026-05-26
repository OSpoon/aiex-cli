import type { EvidenceSummary } from './extraction'

export interface ParsedColumn {
  name: string
  drizzleType: string
  isPrimary: boolean
  isAutoIncrement: boolean
  isNullable: boolean
  isUnique: boolean
  defaultValue?: string
  isForeignKey?: boolean
  foreignKeyRef?: {
    table: string
    column: string
  }
}

export interface ParsedTable {
  name: string
  columns: ParsedColumn[]
}

export interface ParsedRelation {
  fromTable: string
  fromColumn: string
  toTable: string
  toColumn: string
  name: string
}

export interface ParsedReverseRelation {
  type: 'has-one' | 'has-many'
  fromTable: string
  toTable: string
  name: string
}

export interface ParseResult {
  tables: ParsedTable[]
  relations: ParsedRelation[]
  reverseRelations: ParsedReverseRelation[]
  warnings: string[]
}

export interface MigrationConfig {
  schemaPath: string
  drizzleSchemaPath: string
  migrationsPath: string
  databasePath: string
  drizzleConfigPath: string
}

export interface ExtractionRecord {
  name: string
  schemaName: string
  timestamp: string
  fileSize: number
  modifiedAt: string
  evidenceSummary?: EvidenceSummary
  notionStatus: 'synced' | 'failed' | 'not_synced'
  notionPages?: Array<{ databaseId: string, pageId: string }>
  notionError?: string
}

export interface RowExtractionAction {
  extractionName: string
  notionStatus: 'synced' | 'failed' | 'not_synced'
  notionPages?: Array<{ databaseId: string, pageId: string }>
  notionError?: string
}

export interface SqliteTableInfoRow {
  name: string
  type: string
  notnull: number
  pk: number
}

export interface TableColumn {
  name: string
  type: string
  notNull: boolean
  pk: boolean
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

export interface GenerateSchemaResult {
  success: boolean
  error?: string
  warnings: string[]
  schemaCount: number
  tables: number
  relations: number
}

export interface MigrationResult {
  success: boolean
  changes?: number
  tag?: string
  error?: string
}

export interface SchemaSyncResult {
  success: boolean
  error?: string
  warnings: string[]
  schemaCount: number
  tables: number
  relations: number
  migration?: MigrationResult
}

// Re-export validation interfaces from core schema definition
export type {
  ForeignKeyRef,
  JsonSchemaDefinition,
  JsonSchemaProperty,
} from '@/core/schema-sqlite/schemas'
