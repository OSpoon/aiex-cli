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
