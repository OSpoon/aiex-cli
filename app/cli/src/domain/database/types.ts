import type { JsonSchemaDefinition } from '@/domain/schema/schemas'

export type DatabaseDialect = 'sqlite'

export interface DatabaseConfig {
  dialect: DatabaseDialect
  path: string
}

export interface DatabaseTableColumn {
  name: string
  type: string
  notNull: boolean
  pk: boolean
}

export interface DatabaseInsertResult {
  success: boolean
  tablesInserted: Array<{ table: string, rowId: number }>
  error?: string
}

export interface DatabaseTableRowsQuery {
  tableName: string
  page: number
  pageSize: number
  search: string
  sortField?: string
  sortOrder: 'asc' | 'desc'
  all: boolean
}

export interface DatabaseTableRowsResult {
  columns: DatabaseTableColumn[]
  rows: Record<string, unknown>[]
  rowIds: Array<string | undefined>
  total: number
  page: number
  pageSize: number
  totalPages: number
}

export interface ProjectDatabase {
  readonly dialect: DatabaseDialect
  exists: () => Promise<boolean>
  listTableNames: () => Promise<string[]>
  verifyTables: (tableNames: string[]) => Promise<{ ok: boolean, missing: string[], error?: string }>
  insertExtracted: (schema: JsonSchemaDefinition, data: Record<string, unknown>) => DatabaseInsertResult
  readTableRows: (query: DatabaseTableRowsQuery) => Promise<DatabaseTableRowsResult>
}
