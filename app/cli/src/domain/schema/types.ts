export type ColumnType = { class: 'text', mode?: 'json' }
  | { class: 'integer', mode?: 'boolean' | 'timestamp' | 'timestamp_ms' | 'bigint' }
  | { class: 'real' }

export interface CheckConstraint {
  name: string
  column: string
  kind: 'min_length' | 'max_length' | 'min_value' | 'max_value'
  value: number
}

export interface ParsedColumn {
  name: string
  columnType: ColumnType
  isPrimary: boolean
  isAutoIncrement: boolean
  isNullable: boolean
  isUnique: boolean
  default?: unknown
  isForeignKey?: boolean
  foreignKeyRef?: {
    table: string
    column: string
  }
}

export interface ParsedTable {
  name: string
  columns: ParsedColumn[]
  checks?: CheckConstraint[]
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
