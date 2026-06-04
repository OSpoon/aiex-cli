import type { DatabaseDialect } from '@/domain/database'
import type { ParseResult } from '@/domain/schema/types'
import { generateDrizzleSchema } from '@/infrastructure/schema/generate-drizzle-schema'

export function generateDatabaseSchema(result: ParseResult, dialect: DatabaseDialect = 'sqlite'): string {
  switch (dialect) {
    case 'sqlite':
      return generateDrizzleSchema(result)
  }
}
