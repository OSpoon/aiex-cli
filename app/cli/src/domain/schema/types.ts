export type ColumnType = { class: 'text', mode?: 'json' }
  | { class: 'integer', mode?: 'boolean' | 'timestamp' | 'timestamp_ms' | 'bigint' }
  | { class: 'real' }

export interface CheckConstraint {
  name: string
  column: string
  kind: 'min_length' | 'max_length' | 'min_value' | 'max_value' | 'enum_value'
  value: number | (string | number)[]
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

export interface SchemaMappingEntry {
  schemaPath: string
  table: string
  column: string
  drizzleType: string
  databaseType: 'text' | 'integer' | 'real'
  nullable: boolean
  primary: boolean
  unique: boolean
  relation?: 'root' | 'has-one' | 'has-many'
  constraints?: {
    enumValues?: (string | number)[]
    minLength?: number
    maxLength?: number
    minimum?: number
    maximum?: number
  }
  defaultValue?: unknown
  foreignKey?: {
    table: string
    column: string
  }
  notes: string[]
}

export type MigrationRiskSeverity = 'low' | 'medium' | 'high'

export interface MigrationRiskItem {
  severity: MigrationRiskSeverity
  kind:
    | 'table_added'
    | 'table_removed'
    | 'column_added'
    | 'column_removed'
    | 'column_type_changed'
    | 'nullable_tightened'
    | 'nullable_relaxed'
    | 'unique_added'
    | 'primary_changed'
    | 'enum_narrowed'
    | 'enum_changed'
    | 'constraint_tightened'
    | 'constraint_changed'
    | 'default_changed'
    | 'foreign_key_changed'
  table: string
  column?: string
  message: string
}

export interface MigrationRiskReport {
  level: 'none' | MigrationRiskSeverity
  items: MigrationRiskItem[]
  hasHighRisk: boolean
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
  mapping?: SchemaMappingEntry[]
}

export interface MigrationConfig {
  databaseDialect: 'sqlite'
  schemaPath: string
  drizzleSchemaPath: string
  migrationsPath: string
  databasePath: string
  drizzleConfigPath: string
}
