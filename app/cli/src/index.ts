export {
  buildDoctorDiagnostics,
  type DoctorDiagnostics,
  doctorDiagnosticsTableRows,
  formatDoctorDiagnosticsJson,
} from '@/core/doctor'
export {
  createMigrationConfig,
  generateDrizzleConfig,
  generateDrizzleSchema,
  type JsonSchemaDefinition,
  JsonSchemaDefinitionSchema,
  type JsonSchemaProperty,
  type MigrationConfig,
  type ParsedColumn,
  type ParsedRelation,
  type ParsedTable,
  parseJsonSchema,
  type ParseResult,
} from '@/core/schema-sqlite'

export { collectDoctorDiagnostics } from '@/doctor'
