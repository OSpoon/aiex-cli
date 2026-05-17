import type { MigrationConfig } from './types'

export function createMigrationConfig(cwd: string): MigrationConfig {
  return {
    schemaPath: `${cwd}/.aiex/schema`,
    drizzleSchemaPath: `${cwd}/.aiex/drizzle/schema.ts`,
    migrationsPath: `${cwd}/.aiex/migrations`,
    databasePath: `${cwd}/.aiex/database.db`,
    drizzleConfigPath: `${cwd}/.aiex/drizzle.config.ts`,
  }
}

export function generateDrizzleConfig(): string {
  return `export default {
  dialect: 'sqlite',
  schema: './.aiex/drizzle/schema.ts',
  out: './.aiex/migrations',
  dbCredentials: {
    url: './.aiex/database.db',
  },
}
`
}
