import type { ParsedRelation, ParsedReverseRelation, ParsedTable } from '@/domain/schema/types'
import { describe, expect, it } from 'vitest'
import { columnTypeInteger, columnTypeReal, columnTypeText, parseJsonSchema } from '@/domain/schema/parser'
import { JsonSchemaDefinitionSchema } from '@/domain/schema/schemas'
import { generateDrizzleSchema } from '@/infrastructure/schema/generate-drizzle-schema'
import { createMigrationConfig, generateDrizzleConfig } from '@/infrastructure/schema/migration-config'
import {
  sanitizeMigrationName,
} from '@/infrastructure/schema/migration-name'

// ============================================
// Test helper: deep complex schema generator
// ============================================

function createComplexEcommerceSchema() {
  return {
    customers: {
      title: 'Customer',
      type: 'object' as const,
      table: { name: 'customers', timestamps: true, softDelete: true },
      properties: {
        id: { type: 'integer' as const, primary: true, autoIncrement: true },
        email: { type: 'string' as const, unique: true },
        name: { type: 'string' as const },
        creditBalance: { type: 'number' as const, default: 0 },
        isActive: { type: 'boolean' as const, default: true },
        lastLoginAt: { type: 'string' as const, format: 'date-time' },
        metadata: { type: 'object' as const, drizzle: { mode: 'json' as const } },
        // nested has-many: orders
        orders: {
          type: 'array' as const,
          items: {
            type: 'object' as const,
            nested: { enabled: true as const, relation: 'has-many' as const },
            properties: {
              orderNumber: { type: 'string' as const, unique: true },
              status: { type: 'string' as const, default: 'pending' },
              totalAmount: { type: 'number' as const },
              paidAt: { type: 'string' as const, format: 'date-time' },
              notes: { type: 'string' as const },
              // nested has-many: order_items
              items: {
                type: 'array' as const,
                items: {
                  type: 'object' as const,
                  nested: { enabled: true as const, relation: 'has-many' as const },
                  properties: {
                    quantity: { type: 'integer' as const, default: 1 },
                    unitPrice: { type: 'number' as const },
                    productName: { type: 'string' as const },
                  },
                },
              },
            },
          },
        },
        // nested has-one: address
        address: {
          type: 'object' as const,
          nested: { enabled: true as const, relation: 'has-one' as const },
          properties: {
            street: { type: 'string' as const },
            city: { type: 'string' as const },
            zipCode: { type: 'string' as const },
            country: { type: 'string' as const },
            isDefault: { type: 'boolean' as const, default: false },
          },
        },
      },
      required: ['email', 'name'],
    },
    products: {
      title: 'Product',
      type: 'object' as const,
      table: { name: 'products', timestamps: true },
      properties: {
        id: { type: 'integer' as const, primary: true, autoIncrement: true },
        sku: { type: 'string' as const, unique: true },
        name: { type: 'string' as const },
        description: { type: 'string' as const },
        price: { type: 'number' as const },
        stock: { type: 'integer' as const, default: 0 },
        isActive: { type: 'boolean' as const, default: true },
        category: { type: 'string' as const },
        tags: { type: 'array' as const, items: { type: 'string' as const } },
        attributes: { type: 'object' as const, drizzle: { mode: 'json' as const } },
      },
      required: ['sku', 'name', 'price'],
    },
  }
}

describe('schema-sqlite', () => {
  describe('migration naming', () => {
    it('sanitizes --name values for migration filenames', () => {
      expect(sanitizeMigrationName('Create Users Table')).toBe('create_users_table')
      expect(sanitizeMigrationName('  v2: orders/items!  ')).toBe('v2_orders_items')
      expect(sanitizeMigrationName('___')).toBeUndefined()
    })
  })

  describe('jsonSchemaDefinitionSchema validation', () => {
    it('should validate a valid schema', () => {
      const schema = {
        title: 'User',
        type: 'object',
        table: { name: 'users' },
        properties: {
          id: { type: 'integer', primary: true, autoIncrement: true },
          name: { type: 'string' },
        },
      }
      const result = JsonSchemaDefinitionSchema.safeParse(schema)
      expect(result.success).toBe(true)
    })

    it('should reject schema with invalid table name (camelCase)', () => {
      const schema = {
        title: 'User',
        type: 'object',
        table: { name: 'UserTable' },
        properties: {
          id: { type: 'integer' },
        },
      }
      const result = JsonSchemaDefinitionSchema.safeParse(schema)
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues[0].message).toContain('snake_case')
      }
    })

    it('should reject schema with empty properties', () => {
      const schema = {
        title: 'Empty',
        type: 'object',
        table: { name: 'empty' },
        properties: {},
      }
      const result = JsonSchemaDefinitionSchema.safeParse(schema)
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues.some(i => i.message.includes('At least one property'))).toBe(true)
      }
    })

    it('should reject schema with multiple primary keys', () => {
      const schema = {
        title: 'DoublePrimary',
        type: 'object',
        table: { name: 'double_primary' },
        properties: {
          id1: { type: 'integer', primary: true },
          id2: { type: 'integer', primary: true },
        },
      }
      const result = JsonSchemaDefinitionSchema.safeParse(schema)
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues.some(i => i.message.includes('Only one primary key'))).toBe(true)
      }
    })

    it('should reject schema with required field not in properties', () => {
      const schema = {
        title: 'MissingRequired',
        type: 'object',
        table: { name: 'missing_required' },
        properties: {
          id: { type: 'integer' },
        },
        required: ['id', 'missing_field'],
      }
      const result = JsonSchemaDefinitionSchema.safeParse(schema)
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues.some(i => i.message.includes('required fields must be defined'))).toBe(true)
      }
    })

    it('should reject schema with invalid property type', () => {
      const schema = {
        title: 'InvalidType',
        type: 'object',
        table: { name: 'invalid_type' },
        properties: {
          field: { type: 'invalid_type' },
        },
      }
      const result = JsonSchemaDefinitionSchema.safeParse(schema)
      expect(result.success).toBe(false)
    })

    it('should validate nested object schema', () => {
      const schema = {
        title: 'User',
        type: 'object',
        table: { name: 'users' },
        properties: {
          id: { type: 'integer', primary: true },
          profile: {
            type: 'object',
            nested: { enabled: true, relation: 'has-one' },
            properties: {
              bio: { type: 'string' },
            },
          },
        },
      }
      const result = JsonSchemaDefinitionSchema.safeParse(schema)
      expect(result.success).toBe(true)
    })

    it('should validate nested array schema with has-many', () => {
      const schema = {
        title: 'User',
        type: 'object',
        table: { name: 'users' },
        properties: {
          id: { type: 'integer', primary: true },
          posts: {
            type: 'array',
            items: {
              type: 'object',
              nested: { enabled: true, relation: 'has-many' },
              properties: {
                title: { type: 'string' },
              },
            },
          },
        },
      }
      const result = JsonSchemaDefinitionSchema.safeParse(schema)
      expect(result.success).toBe(true)
    })
  })

  describe('parseJsonSchema', () => {
    it('should parse basic schema with correct column types', () => {
      const schema = {
        title: 'User',
        type: 'object',
        table: { name: 'users' },
        properties: {
          id: { type: 'integer', primary: true, autoIncrement: true },
          name: { type: 'string' },
          age: { type: 'integer' },
          balance: { type: 'number' },
          active: { type: 'boolean' },
          metadata: { type: 'object' },
          tags: { type: 'array' },
          createdAt: { type: 'string', format: 'date-time' },
        },
        required: ['name'],
      }

      const validated = JsonSchemaDefinitionSchema.parse(schema)
      const result = parseJsonSchema(validated)

      expect(result.tables.length).toBe(1)
      expect(result.relations.length).toBe(0)
      expect(result.reverseRelations.length).toBe(0)

      const table = result.tables[0]
      expect(table.name).toBe('users')
      expect(table.columns.length).toBe(8)

      const idCol = table.columns.find(c => c.name === 'id')
      expect(idCol?.columnType).toEqual(columnTypeInteger())
      expect(idCol?.isPrimary).toBe(true)
      expect(idCol?.isAutoIncrement).toBe(true)

      const nameCol = table.columns.find(c => c.name === 'name')
      expect(nameCol?.columnType).toEqual(columnTypeText())
      expect(nameCol?.isNullable).toBe(false)

      const ageCol = table.columns.find(c => c.name === 'age')
      expect(ageCol?.columnType).toEqual(columnTypeInteger())

      const balanceCol = table.columns.find(c => c.name === 'balance')
      expect(balanceCol?.columnType).toEqual(columnTypeReal())

      const activeCol = table.columns.find(c => c.name === 'active')
      expect(activeCol?.columnType).toEqual(columnTypeInteger('boolean'))

      const metadataCol = table.columns.find(c => c.name === 'metadata')
      expect(metadataCol?.columnType).toEqual(columnTypeText('json'))

      const tagsCol = table.columns.find(c => c.name === 'tags')
      expect(tagsCol?.columnType).toEqual(columnTypeText('json'))

      const createdAtCol = table.columns.find(c => c.name === 'created_at')
      expect(createdAtCol?.columnType).toEqual(columnTypeInteger('timestamp'))
    })

    it('should ignore examples/few-shot data and not generate columns for it', () => {
      const schema = {
        title: 'User',
        type: 'object',
        table: { name: 'users' },
        properties: {
          id: { type: 'integer', primary: true, autoIncrement: true },
          name: { type: 'string' },
        },
        examples: [
          {
            text: 'Alice is here',
            output: { id: 1, name: 'Alice' },
          },
        ],
        required: ['name'],
      }

      const validated = JsonSchemaDefinitionSchema.parse(schema)
      const result = parseJsonSchema(validated)

      expect(result.tables.length).toBe(1)
      const table = result.tables[0]
      expect(table.columns.length).toBe(2) // only id and name
      expect(table.columns.map(c => c.name)).not.toContain('examples')
    })

    it('should add timestamp columns when enabled', () => {
      const schema = {
        title: 'User',
        type: 'object',
        table: { name: 'users', timestamps: true },
        properties: {
          id: { type: 'integer', primary: true },
        },
      }

      const validated = JsonSchemaDefinitionSchema.parse(schema)
      const result = parseJsonSchema(validated)

      const table = result.tables[0]
      expect(table.columns.find(c => c.name === 'created_at')).toBeDefined()
      expect(table.columns.find(c => c.name === 'updated_at')).toBeDefined()
    })

    it('should add soft delete column when enabled', () => {
      const schema = {
        title: 'User',
        type: 'object',
        table: { name: 'users', softDelete: true },
        properties: {
          id: { type: 'integer', primary: true },
        },
      }

      const validated = JsonSchemaDefinitionSchema.parse(schema)
      const result = parseJsonSchema(validated)

      const table = result.tables[0]
      const deletedAt = table.columns.find(c => c.name === 'deleted_at')
      expect(deletedAt).toBeDefined()
      expect(deletedAt?.isNullable).toBe(true)
    })

    it('should skip user-defined createdAt when timestamps enabled', () => {
      const schema = {
        title: 'User',
        type: 'object',
        table: { name: 'users', timestamps: true },
        properties: {
          id: { type: 'integer', primary: true },
          createdAt: { type: 'string', format: 'date-time' },
        },
      }

      const validated = JsonSchemaDefinitionSchema.parse(schema)
      const result = parseJsonSchema(validated)

      const table = result.tables[0]
      const createdAtCols = table.columns.filter(c => c.name === 'created_at')
      expect(createdAtCols.length).toBe(1)
    })

    it('should parse nested has-one object into separate table', () => {
      const schema = {
        title: 'User',
        type: 'object',
        table: { name: 'users' },
        properties: {
          id: { type: 'integer', primary: true },
          profile: {
            type: 'object',
            nested: { enabled: true, relation: 'has-one' },
            properties: {
              bio: { type: 'string' },
              avatar: { type: 'string' },
            },
          },
        },
      }

      const validated = JsonSchemaDefinitionSchema.parse(schema)
      const result = parseJsonSchema(validated)

      expect(result.tables.length).toBe(2)
      expect(result.relations.length).toBe(1)
      expect(result.reverseRelations.length).toBe(1)

      const profileTable = result.tables.find(t => t.name === 'users_profile')
      expect(profileTable).toBeDefined()
      expect(profileTable?.columns.find(c => c.name === 'users_id')).toBeDefined()
      expect(profileTable?.columns.find(c => c.name === 'bio')).toBeDefined()

      const relation = result.relations[0]
      expect(relation.fromTable).toBe('users_profile')
      expect(relation.toTable).toBe('users')
      expect(relation.fromColumn).toBe('users_id')
      expect(relation.toColumn).toBe('id')

      const reverseRelation = result.reverseRelations[0]
      expect(reverseRelation.type).toBe('has-one')
      expect(reverseRelation.fromTable).toBe('users')
      expect(reverseRelation.toTable).toBe('users_profile')
      expect(reverseRelation.name).toBe('profile')
    })

    it('should parse nested has-many array into separate table', () => {
      const schema = {
        title: 'User',
        type: 'object',
        table: { name: 'users' },
        properties: {
          id: { type: 'integer', primary: true },
          orders: {
            type: 'array',
            items: {
              type: 'object',
              nested: { enabled: true, relation: 'has-many' },
              properties: {
                total: { type: 'number' },
                status: { type: 'string' },
              },
            },
          },
        },
      }

      const validated = JsonSchemaDefinitionSchema.parse(schema)
      const result = parseJsonSchema(validated)

      expect(result.tables.length).toBe(2)
      expect(result.relations.length).toBe(1)
      expect(result.reverseRelations.length).toBe(1)

      const ordersTable = result.tables.find(t => t.name === 'users_orders')
      expect(ordersTable).toBeDefined()

      const relation = result.relations[0]
      expect(relation.fromTable).toBe('users_orders')
      expect(relation.toTable).toBe('users')

      const reverseRelation = result.reverseRelations[0]
      expect(reverseRelation.type).toBe('has-many')
      expect(reverseRelation.fromTable).toBe('users')
      expect(reverseRelation.toTable).toBe('users_orders')
      expect(reverseRelation.name).toBe('orders')
    })

    it('should handle unique and default values', () => {
      const schema = {
        title: 'User',
        type: 'object',
        table: { name: 'users' },
        properties: {
          id: { type: 'integer', primary: true },
          email: { type: 'string', unique: true },
          active: { type: 'boolean', default: true },
        },
      }

      const validated = JsonSchemaDefinitionSchema.parse(schema)
      const result = parseJsonSchema(validated)

      const table = result.tables[0]
      const emailCol = table.columns.find(c => c.name === 'email')
      expect(emailCol?.isUnique).toBe(true)

      const activeCol = table.columns.find(c => c.name === 'active')
      expect(activeCol?.default).toBe(true)
    })

    it('should skip nested object with drizzle mode json (not separate table)', () => {
      const schema = {
        title: 'User',
        type: 'object',
        table: { name: 'users' },
        properties: {
          id: { type: 'integer', primary: true },
          settings: {
            type: 'object',
            drizzle: { mode: 'json' },
            properties: {
              theme: { type: 'string' },
              lang: { type: 'string' },
            },
          },
        },
      }

      const validated = JsonSchemaDefinitionSchema.parse(schema)
      const result = parseJsonSchema(validated)

      expect(result.tables.length).toBe(1)
      expect(result.relations.length).toBe(0)

      const table = result.tables[0]
      const settingsCol = table.columns.find(c => c.name === 'settings')
      expect(settingsCol?.columnType).toEqual(columnTypeText('json'))
    })

    it('should skip array items without nested enabled (treated as json column)', () => {
      const schema = {
        title: 'Post',
        type: 'object',
        table: { name: 'posts' },
        properties: {
          id: { type: 'integer', primary: true },
          tags: {
            type: 'array',
            items: {
              type: 'string',
            },
          },
        },
      }

      const validated = JsonSchemaDefinitionSchema.parse(schema)
      const result = parseJsonSchema(validated)

      expect(result.tables.length).toBe(1)
      expect(result.relations.length).toBe(0)

      const table = result.tables[0]
      const tagsCol = table.columns.find(c => c.name === 'tags')
      expect(tagsCol?.columnType).toEqual(columnTypeText('json'))
    })
  })

  describe('generateDrizzleSchema', () => {
    it('should generate correct Drizzle schema code', () => {
      const result = {
        tables: [{
          name: 'users',
          columns: [
            { name: 'id', columnType: columnTypeInteger(), isPrimary: true, isAutoIncrement: true, isNullable: false, isUnique: false },
            { name: 'name', columnType: columnTypeText(), isPrimary: false, isAutoIncrement: false, isNullable: false, isUnique: false },
            { name: 'email', columnType: columnTypeText(), isPrimary: false, isAutoIncrement: false, isNullable: true, isUnique: true },
          ],
        }],
        relations: [],
        reverseRelations: [],
        warnings: [],
      }

      const code = generateDrizzleSchema(result)

      expect(code).toContain('import { sqliteTable, text, integer, real } from \'drizzle-orm/sqlite-core\'')
      expect(code).toContain('import { relations } from \'drizzle-orm\'')
      expect(code).toContain('export const users = sqliteTable(\'users\', {')
      expect(code).toContain('id: integer().primaryKey({ autoIncrement: true })')
      expect(code).toContain('name: text().notNull()')
      expect(code).toContain('email: text().unique()')
    })

    it('should generate child table relation with one()', () => {
      const result = {
        tables: [
          { name: 'users', columns: [{ name: 'id', columnType: columnTypeInteger(), isPrimary: true, isAutoIncrement: true, isNullable: false, isUnique: false }] },
          { name: 'users_profile', columns: [
            { name: 'id', columnType: columnTypeInteger(), isPrimary: true, isAutoIncrement: true, isNullable: false, isUnique: false },
            { name: 'users_id', columnType: columnTypeInteger(), isPrimary: false, isAutoIncrement: false, isNullable: false, isUnique: false },
            { name: 'bio', columnType: columnTypeText(), isPrimary: false, isAutoIncrement: false, isNullable: true, isUnique: false },
          ] },
        ],
        relations: [{
          fromTable: 'users_profile',
          fromColumn: 'users_id',
          toTable: 'users',
          toColumn: 'id',
          name: 'users',
        }],
        reverseRelations: [{
          type: 'has-one' as const,
          fromTable: 'users',
          toTable: 'users_profile',
          name: 'profile',
        }],
        warnings: [],
      }

      const code = generateDrizzleSchema(result)

      expect(code).toContain('export const users_profileRelations = relations(users_profile')
      expect(code).toContain('one(users, {')
      expect(code).toContain('fields: [users_profile.users_id]')
      expect(code).toContain('references: [users.id]')
    })

    it('should generate parent table relation with one() for has-one', () => {
      const result = {
        tables: [
          { name: 'users', columns: [{ name: 'id', columnType: columnTypeInteger(), isPrimary: true, isAutoIncrement: true, isNullable: false, isUnique: false }] },
          { name: 'users_profile', columns: [
            { name: 'id', columnType: columnTypeInteger(), isPrimary: true, isAutoIncrement: true, isNullable: false, isUnique: false },
            { name: 'users_id', columnType: columnTypeInteger(), isPrimary: false, isAutoIncrement: false, isNullable: false, isUnique: false },
          ] },
        ],
        relations: [{
          fromTable: 'users_profile',
          fromColumn: 'users_id',
          toTable: 'users',
          toColumn: 'id',
          name: 'users',
        }],
        reverseRelations: [{
          type: 'has-one' as const,
          fromTable: 'users',
          toTable: 'users_profile',
          name: 'profile',
        }],
        warnings: [],
      }

      const code = generateDrizzleSchema(result)

      expect(code).toContain('export const usersRelations = relations(users')
      expect(code).toContain('profile: one(users_profile)')
    })

    it('should generate parent table relation with many() for has-many', () => {
      const result = {
        tables: [
          { name: 'users', columns: [{ name: 'id', columnType: columnTypeInteger(), isPrimary: true, isAutoIncrement: true, isNullable: false, isUnique: false }] },
          { name: 'users_orders', columns: [
            { name: 'id', columnType: columnTypeInteger(), isPrimary: true, isAutoIncrement: true, isNullable: false, isUnique: false },
            { name: 'users_id', columnType: columnTypeInteger(), isPrimary: false, isAutoIncrement: false, isNullable: false, isUnique: false },
          ] },
        ],
        relations: [{
          fromTable: 'users_orders',
          fromColumn: 'users_id',
          toTable: 'users',
          toColumn: 'id',
          name: 'users',
        }],
        reverseRelations: [{
          type: 'has-many' as const,
          fromTable: 'users',
          toTable: 'users_orders',
          name: 'orders',
        }],
        warnings: [],
      }

      const code = generateDrizzleSchema(result)

      expect(code).toContain('export const usersRelations = relations(users')
      expect(code).toContain('orders: many(users_orders)')
    })
  })

  describe('createMigrationConfig', () => {
    it('should create config with correct paths', () => {
      const config = createMigrationConfig('/project')

      expect(config.databaseDialect).toBe('sqlite')
      expect(config.schemaPath).toBe('/project/.aiex/schema')
      expect(config.drizzleSchemaPath).toBe('/project/.aiex/drizzle/schema.ts')
      expect(config.migrationsPath).toBe('/project/.aiex/migrations')
      expect(config.databasePath).toBe('/project/.aiex/database.db')
      expect(config.drizzleConfigPath).toBe('/project/.aiex/drizzle.config.ts')
    })
  })

  describe('generateDrizzleConfig', () => {
    it('should generate valid drizzle.config.ts content', () => {
      const content = generateDrizzleConfig()

      expect(content).toContain('export default')
      expect(content).toContain('dialect: \'sqlite\'')
      expect(content).toContain('schema: \'./.aiex/drizzle/schema.ts\'')
      expect(content).toContain('out: \'./.aiex/migrations\'')
      expect(content).toContain('url: \'./.aiex/database.db\'')
    })
  })

  // ============================================
  // Advanced parser tests
  // ============================================

  describe('parseJsonSchema - advanced type mappings', () => {
    it('should map integer with drizzle.mode timestamp_ms correctly', () => {
      const schema = {
        title: 'Event',
        type: 'object',
        table: { name: 'events' },
        properties: {
          id: { type: 'integer', primary: true },
          createdAt: { type: 'integer', drizzle: { mode: 'timestamp_ms' } },
        },
      }
      const validated = JsonSchemaDefinitionSchema.parse(schema)
      const result = parseJsonSchema(validated)

      const col = result.tables[0].columns.find(c => c.name === 'created_at')
      expect(col?.columnType).toEqual(columnTypeInteger('timestamp_ms'))
    })

    it('should map integer with drizzle.mode bigint correctly', () => {
      const schema = {
        title: 'Analytics',
        type: 'object',
        table: { name: 'analytics' },
        properties: {
          id: { type: 'integer', primary: true },
          bigValue: { type: 'integer', drizzle: { mode: 'bigint' } },
        },
      }
      const validated = JsonSchemaDefinitionSchema.parse(schema)
      const result = parseJsonSchema(validated)

      const col = result.tables[0].columns.find(c => c.name === 'big_value')
      expect(col?.columnType).toEqual(columnTypeInteger('bigint'))
    })

    it('should map null type to text()', () => {
      const schema = {
        title: 'Test',
        type: 'object',
        table: { name: 'test_null' },
        properties: {
          id: { type: 'integer', primary: true },
          emptyField: { type: 'null' },
        },
      }
      const validated = JsonSchemaDefinitionSchema.parse(schema)
      const result = parseJsonSchema(validated)

      const col = result.tables[0].columns.find(c => c.name === 'empty_field')
      expect(col?.columnType).toEqual(columnTypeText())
    })

    it('should map string with format json to text json mode', () => {
      const schema = {
        title: 'Test',
        type: 'object',
        table: { name: 'test_json_format' },
        properties: {
          id: { type: 'integer', primary: true },
          config: { type: 'string', format: 'json' },
        },
      }
      const validated = JsonSchemaDefinitionSchema.parse(schema)
      const result = parseJsonSchema(validated)

      const col = result.tables[0].columns.find(c => c.name === 'config')
      expect(col?.columnType).toEqual(columnTypeText('json'))
    })

    it('should map string with drizzle.mode timestamp to integer timestamp', () => {
      const schema = {
        title: 'Test',
        type: 'object',
        table: { name: 'test_str_ts' },
        properties: {
          id: { type: 'integer', primary: true },
          eventTime: { type: 'string', drizzle: { mode: 'timestamp' } },
        },
      }
      const validated = JsonSchemaDefinitionSchema.parse(schema)
      const result = parseJsonSchema(validated)

      const col = result.tables[0].columns.find(c => c.name === 'event_time')
      expect(col?.columnType).toEqual(columnTypeInteger('timestamp'))
    })
  })

  describe('parseJsonSchema - default values', () => {
    it('should handle string default values', () => {
      const schema = {
        title: 'Test',
        type: 'object',
        table: { name: 'test_defaults' },
        properties: {
          id: { type: 'integer', primary: true },
          role: { type: 'string', default: 'user' },
          count: { type: 'integer', default: 0 },
          active: { type: 'boolean', default: true },
          score: { type: 'number', default: 0.5 },
        },
      }
      const validated = JsonSchemaDefinitionSchema.parse(schema)
      const result = parseJsonSchema(validated)
      const cols = result.tables[0].columns

      expect(cols.find(c => c.name === 'role')?.default).toBe('user')
      expect(cols.find(c => c.name === 'count')?.default).toBe(0)
      expect(cols.find(c => c.name === 'active')?.default).toBe(true)
      expect(cols.find(c => c.name === 'score')?.default).toBe(0.5)
    })

    it('should handle object and array default values via JSON.stringify', () => {
      const schema = {
        title: 'Test',
        type: 'object',
        table: { name: 'test_obj_defaults' },
        properties: {
          id: { type: 'integer', primary: true },
          config: { type: 'object', default: { theme: 'dark' } },
          flags: { type: 'array', default: ['a', 'b'] },
        },
      }
      const validated = JsonSchemaDefinitionSchema.parse(schema)
      const result = parseJsonSchema(validated)
      const cols = result.tables[0].columns

      expect(cols.find(c => c.name === 'config')?.default).toEqual({ theme: 'dark' })
      expect(cols.find(c => c.name === 'flags')?.default).toEqual(['a', 'b'])
    })

    it('should handle null default value', () => {
      const schema = {
        title: 'Test',
        type: 'object',
        table: { name: 'test_null_default' },
        properties: {
          id: { type: 'integer', primary: true },
          note: { type: 'string', default: null },
        },
      }
      const validated = JsonSchemaDefinitionSchema.parse(schema)
      const result = parseJsonSchema(validated)

      const col = result.tables[0].columns.find(c => c.name === 'note')
      expect(col?.default).toBe(null)
    })

    it('should have no defaultValue when not specified', () => {
      const schema = {
        title: 'Test',
        type: 'object',
        table: { name: 'test_no_default' },
        properties: {
          id: { type: 'integer', primary: true },
          name: { type: 'string' },
        },
      }
      const validated = JsonSchemaDefinitionSchema.parse(schema)
      const result = parseJsonSchema(validated)

      const col = result.tables[0].columns.find(c => c.name === 'name')
      expect(col?.default).toBeUndefined()
    })
  })

  describe('parseJsonSchema - column constraints', () => {
    it('should handle non-autoIncrement primary key', () => {
      const schema = {
        title: 'Test',
        type: 'object',
        table: { name: 'test_natural_pk' },
        properties: {
          code: { type: 'string', primary: true },
          name: { type: 'string' },
        },
      }
      const validated = JsonSchemaDefinitionSchema.parse(schema)
      const result = parseJsonSchema(validated)

      const pk = result.tables[0].columns.find(c => c.name === 'code')
      expect(pk?.isPrimary).toBe(true)
      expect(pk?.isAutoIncrement).toBe(false)
      expect(pk?.columnType).toEqual(columnTypeText())
    })

    it('should mark required fields as not nullable', () => {
      const schema = {
        title: 'Test',
        type: 'object',
        table: { name: 'test_required' },
        properties: {
          id: { type: 'integer', primary: true },
          email: { type: 'string' },
          nickname: { type: 'string' },
        },
        required: ['email'],
      }
      const validated = JsonSchemaDefinitionSchema.parse(schema)
      const result = parseJsonSchema(validated)
      const cols = result.tables[0].columns

      expect(cols.find(c => c.name === 'email')?.isNullable).toBe(false)
      expect(cols.find(c => c.name === 'nickname')?.isNullable).toBe(true)
    })

    it('should make primary keys implicitly not nullable regardless of required', () => {
      const schema = {
        title: 'Test',
        type: 'object',
        table: { name: 'test_pk_nullable' },
        properties: {
          id: { type: 'integer', primary: true },
        },
      }
      const validated = JsonSchemaDefinitionSchema.parse(schema)
      const result = parseJsonSchema(validated)

      const pk = result.tables[0].columns.find(c => c.name === 'id')
      expect(pk?.isNullable).toBe(false)
    })

    it('should handle unique and notNull together', () => {
      const schema = {
        title: 'Test',
        type: 'object',
        table: { name: 'test_unique_notnull' },
        properties: {
          id: { type: 'integer', primary: true },
          slug: { type: 'string', unique: true },
        },
        required: ['slug'],
      }
      const validated = JsonSchemaDefinitionSchema.parse(schema)
      const result = parseJsonSchema(validated)
      const col = result.tables[0].columns.find(c => c.name === 'slug')

      expect(col?.isUnique).toBe(true)
      expect(col?.isNullable).toBe(false)
    })
  })

  describe('parseJsonSchema - snake case edge cases', () => {
    it('should convert camelCase property names to snake_case', () => {
      const schema = {
        title: 'Test',
        type: 'object',
        table: { name: 'test_camel' },
        properties: {
          id: { type: 'integer', primary: true },
          firstName: { type: 'string' },
          lastName: { type: 'string' },
          createdAt: { type: 'string', format: 'date-time' },
        },
      }
      const validated = JsonSchemaDefinitionSchema.parse(schema)
      const result = parseJsonSchema(validated)
      const names = result.tables[0].columns.map(c => c.name)

      expect(names).toContain('first_name')
      expect(names).toContain('last_name')
      expect(names).toContain('created_at')
    })

    it('should handle consecutive uppercase in property names', () => {
      const schema = {
        title: 'Test',
        type: 'object',
        table: { name: 'test_acronym' },
        properties: {
          id: { type: 'integer', primary: true },
          htmlContent: { type: 'string' },
          apiKey: { type: 'string' },
          HTMLParser: { type: 'string' },
        },
      }
      const validated = JsonSchemaDefinitionSchema.parse(schema)
      const result = parseJsonSchema(validated)
      const names = result.tables[0].columns.map(c => c.name)

      // camelCase: htmlContent → html_content (desirable)
      expect(names).toContain('html_content')
      // camelCase: apiKey → api_key
      expect(names).toContain('api_key')
      // Starts with uppercase: HTMLParser → _h_t_m_l_parser (edge case)
      expect(names).toContain('_h_t_m_l_parser')
    })
  })

  describe('parseJsonSchema - multiple nested relations', () => {
    it('should parse schema with both has-one and has-many nested relations', () => {
      const schema = {
        title: 'User',
        type: 'object',
        table: { name: 'users', timestamps: true },
        properties: {
          id: { type: 'integer', primary: true, autoIncrement: true },
          email: { type: 'string', unique: true },
          // has-one: profile
          profile: {
            type: 'object',
            nested: { enabled: true, relation: 'has-one' },
            properties: {
              bio: { type: 'string' },
              avatar: { type: 'string' },
            },
          },
          // has-many: posts
          posts: {
            type: 'array',
            items: {
              type: 'object',
              nested: { enabled: true, relation: 'has-many' },
              properties: {
                title: { type: 'string' },
                content: { type: 'string' },
              },
            },
          },
          // has-many: orders
          orders: {
            type: 'array',
            items: {
              type: 'object',
              nested: { enabled: true, relation: 'has-many' },
              properties: {
                total: { type: 'number' },
                status: { type: 'string', default: 'pending' },
              },
            },
          },
        },
      }
      const validated = JsonSchemaDefinitionSchema.parse(schema)
      const result = parseJsonSchema(validated)

      // 1 main + 3 nested = 4 tables
      expect(result.tables.length).toBe(4)
      expect(result.relations.length).toBe(3)
      expect(result.reverseRelations.length).toBe(3)

      // Main table should have columns: id, email, created_at, updated_at
      const mainTable = result.tables.find(t => t.name === 'users')
      expect(mainTable?.columns.map(c => c.name)).toEqual(
        expect.arrayContaining(['id', 'email', 'created_at', 'updated_at']),
      )

      // Nested tables
      expect(result.tables.find(t => t.name === 'users_profile')).toBeDefined()
      expect(result.tables.find(t => t.name === 'users_posts')).toBeDefined()
      expect(result.tables.find(t => t.name === 'users_orders')).toBeDefined()

      // Reverse relations
      const profileReverse = result.reverseRelations.find(r => r.name === 'profile')
      expect(profileReverse?.type).toBe('has-one')

      const postsReverse = result.reverseRelations.find(r => r.name === 'posts')
      expect(postsReverse?.type).toBe('has-many')

      const ordersReverse = result.reverseRelations.find(r => r.name === 'orders')
      expect(ordersReverse?.type).toBe('has-many')
    })

    it('should skip deeply nested (2nd level) objects within nested', () => {
      // Nested within nested should be skipped (single-level nesting only)
      const schema = {
        title: 'User',
        type: 'object',
        table: { name: 'users' },
        properties: {
          id: { type: 'integer', primary: true },
          settings: {
            type: 'object',
            nested: { enabled: true, relation: 'has-one' },
            properties: {
              theme: { type: 'string' },
              // This nested object within a nested object should be skipped
              advancedConfig: {
                type: 'object',
                nested: { enabled: true, relation: 'has-one' },
                properties: {
                  key: { type: 'string' },
                },
              },
            },
          },
        },
      }
      const validated = JsonSchemaDefinitionSchema.parse(schema)
      const result = parseJsonSchema(validated)

      // Only 2 tables: users and users_settings (no users_settings_advanced_config)
      expect(result.tables.length).toBe(2)
      // Only 1 relation
      expect(result.relations.length).toBe(1)

      const settingsTable = result.tables.find(t => t.name === 'users_settings')
      // advancedConfig should be skipped, only theme column (plus id and FK)
      expect(settingsTable?.columns.find(c => c.name === 'advanced_config')).toBeUndefined()
      expect(settingsTable?.columns.find(c => c.name === 'theme')).toBeDefined()
    })
  })

  describe('parseJsonSchema - dedup with timestamps/softDelete', () => {
    it('should deduplicate updatedAt and deletedAt alongside createdAt', () => {
      const schema = {
        title: 'Test',
        type: 'object',
        table: { name: 'test_dedup', timestamps: true, softDelete: true },
        properties: {
          id: { type: 'integer', primary: true },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
          deletedAt: { type: 'string', format: 'date-time' },
          name: { type: 'string' },
        },
      }
      const validated = JsonSchemaDefinitionSchema.parse(schema)
      const result = parseJsonSchema(validated)
      const table = result.tables[0]

      const createdAtCols = table.columns.filter(c => c.name === 'created_at')
      const updatedAtCols = table.columns.filter(c => c.name === 'updated_at')
      const deletedAtCols = table.columns.filter(c => c.name === 'deleted_at')

      expect(createdAtCols.length).toBe(1)
      expect(updatedAtCols.length).toBe(1)
      expect(deletedAtCols.length).toBe(1)
    })

    it('should add timestamp columns with correct properties', () => {
      const schema = {
        title: 'Test',
        type: 'object',
        table: { name: 'test_ts_props', timestamps: true, softDelete: true },
        properties: {
          id: { type: 'integer', primary: true },
        },
      }
      const validated = JsonSchemaDefinitionSchema.parse(schema)
      const result = parseJsonSchema(validated)
      const cols = result.tables[0].columns

      const createdAt = cols.find(c => c.name === 'created_at')
      expect(createdAt?.columnType).toEqual(columnTypeInteger('timestamp'))
      expect(createdAt?.isNullable).toBe(false)

      const updatedAt = cols.find(c => c.name === 'updated_at')
      expect(updatedAt?.columnType).toEqual(columnTypeInteger('timestamp'))
      expect(updatedAt?.isNullable).toBe(false)

      const deletedAt = cols.find(c => c.name === 'deleted_at')
      expect(deletedAt?.columnType).toEqual(columnTypeInteger('timestamp'))
      expect(deletedAt?.isNullable).toBe(true)
    })
  })

  // ============================================
  // Advanced generator tests
  // ============================================

  describe('generateDrizzleSchema - advanced column definitions', () => {
    it('should generate non-autoIncrement primary key correctly', () => {
      const result = {
        tables: [{
          name: 'categories',
          columns: [
            { name: 'code', columnType: columnTypeText(), isPrimary: true, isAutoIncrement: false, isNullable: false, isUnique: false },
            { name: 'label', columnType: columnTypeText(), isPrimary: false, isAutoIncrement: false, isNullable: false, isUnique: false },
          ],
        }],
        relations: [],
        reverseRelations: [],
        warnings: [],
      }

      const code = generateDrizzleSchema(result)
      expect(code).toContain('code: text().primaryKey()')
      // primaryKey implies notNull, so no .notNull()
      expect(code).not.toContain('code: text().primaryKey().notNull()')
    })

    it('should generate column with default value', () => {
      const result = {
        tables: [{
          name: 'test',
          columns: [
            { name: 'id', columnType: columnTypeInteger(), isPrimary: true, isAutoIncrement: true, isNullable: false, isUnique: false },
            { name: 'role', columnType: columnTypeText(), isPrimary: false, isAutoIncrement: false, isNullable: true, isUnique: false, default: 'admin' },
            { name: 'count', columnType: columnTypeInteger(), isPrimary: false, isAutoIncrement: false, isNullable: true, isUnique: false, default: 0 },
          ],
        }],
        relations: [],
        reverseRelations: [],
        warnings: [],
      }

      const code = generateDrizzleSchema(result)
      expect(code).toContain('role: text().default("admin")')
      expect(code).toContain('count: integer().default(0)')
    })

    it('should generate unique + notNull column', () => {
      const result = {
        tables: [{
          name: 'test',
          columns: [
            { name: 'id', columnType: columnTypeInteger(), isPrimary: true, isAutoIncrement: true, isNullable: false, isUnique: false },
            { name: 'email', columnType: columnTypeText(), isPrimary: false, isAutoIncrement: false, isNullable: false, isUnique: true },
          ],
        }],
        relations: [],
        reverseRelations: [],
        warnings: [],
      }

      const code = generateDrizzleSchema(result)
      expect(code).toContain('email: text().notNull().unique()')
    })

    it('should not add unique() on primary key columns', () => {
      const result = {
        tables: [{
          name: 'test',
          columns: [
            { name: 'id', columnType: columnTypeInteger(), isPrimary: true, isAutoIncrement: false, isNullable: false, isUnique: true },
          ],
        }],
        relations: [],
        reverseRelations: [],
        warnings: [],
      }

      const code = generateDrizzleSchema(result)
      expect(code).toContain('id: integer().primaryKey()')
      expect(code).not.toContain('.unique()')
    })

    it('should generate all type columns correctly', () => {
      const result = {
        tables: [{
          name: 'all_types',
          columns: [
            { name: 'id', columnType: columnTypeInteger(), isPrimary: true, isAutoIncrement: true, isNullable: false, isUnique: false },
            { name: 'name', columnType: columnTypeText(), isPrimary: false, isAutoIncrement: false, isNullable: false, isUnique: false },
            { name: 'score', columnType: columnTypeReal(), isPrimary: false, isAutoIncrement: false, isNullable: true, isUnique: false },
            { name: 'active', columnType: columnTypeInteger('boolean'), isPrimary: false, isAutoIncrement: false, isNullable: true, isUnique: false },
            { name: 'data', columnType: columnTypeText('json'), isPrimary: false, isAutoIncrement: false, isNullable: true, isUnique: false },
            { name: 'created_at', columnType: columnTypeInteger('timestamp'), isPrimary: false, isAutoIncrement: false, isNullable: false, isUnique: false },
            { name: 'big_id', columnType: columnTypeInteger('bigint'), isPrimary: false, isAutoIncrement: false, isNullable: true, isUnique: false },
          ],
        }],
        relations: [],
        reverseRelations: [],
        warnings: [],
      }

      const code = generateDrizzleSchema(result)
      expect(code).toContain('name: text().notNull()')
      expect(code).toContain('score: real()')
      expect(code).toContain(`active: integer({ mode: 'boolean' })`)
      expect(code).toContain(`data: text({ mode: 'json' })`)
      expect(code).toContain(`created_at: integer({ mode: 'timestamp' }).notNull()`)
      expect(code).toContain(`big_id: integer({ mode: 'bigint' })`)
    })
  })

  describe('generateDrizzleSchema - merged relation exports', () => {
    it('should merge child and parent relations for the same table into one export', () => {
      // Table 'users' is both a child (of organizations) and a parent (of users_profile)
      const result = {
        tables: [
          { name: 'organizations', columns: [{ name: 'id', columnType: columnTypeInteger(), isPrimary: true, isAutoIncrement: true, isNullable: false, isUnique: false }] },
          { name: 'users', columns: [
            { name: 'id', columnType: columnTypeInteger(), isPrimary: true, isAutoIncrement: true, isNullable: false, isUnique: false },
            { name: 'organizations_id', columnType: columnTypeInteger(), isPrimary: false, isAutoIncrement: false, isNullable: false, isUnique: false },
          ] },
          { name: 'users_profile', columns: [
            { name: 'id', columnType: columnTypeInteger(), isPrimary: true, isAutoIncrement: true, isNullable: false, isUnique: false },
            { name: 'users_id', columnType: columnTypeInteger(), isPrimary: false, isAutoIncrement: false, isNullable: false, isUnique: false },
          ] },
        ],
        relations: [
          { fromTable: 'users', fromColumn: 'organizations_id', toTable: 'organizations', toColumn: 'id', name: 'organizations' },
          { fromTable: 'users_profile', fromColumn: 'users_id', toTable: 'users', toColumn: 'id', name: 'users' },
        ],
        reverseRelations: [
          { type: 'has-many' as const, fromTable: 'organizations', toTable: 'users', name: 'users' },
          { type: 'has-one' as const, fromTable: 'users', toTable: 'users_profile', name: 'profile' },
        ],
        warnings: [],
      }

      const code = generateDrizzleSchema(result)

      // users should have ONE merged relation export
      const usersRelationsMatches = code.match(/export const usersRelations =/g)
      expect(usersRelationsMatches?.length).toBe(1)

      // It should contain both one() and many() in the same export
      const usersRelationsBlock = code.match(/export const usersRelations = relations\(users.*?\}\)\)/s)
      expect(usersRelationsBlock).toBeDefined()
      expect(usersRelationsBlock![0]).toContain('one(organizations')
      expect(usersRelationsBlock![0]).toContain('one(users_profile)')
    })

    it('should generate separate exports for unrelated tables', () => {
      const result = {
        tables: [
          { name: 'users', columns: [{ name: 'id', columnType: columnTypeInteger(), isPrimary: true, isAutoIncrement: true, isNullable: false, isUnique: false }] },
          { name: 'users_profile', columns: [
            { name: 'id', columnType: columnTypeInteger(), isPrimary: true, isAutoIncrement: true, isNullable: false, isUnique: false },
            { name: 'users_id', columnType: columnTypeInteger(), isPrimary: false, isAutoIncrement: false, isNullable: false, isUnique: false },
          ] },
        ],
        relations: [
          { fromTable: 'users_profile', fromColumn: 'users_id', toTable: 'users', toColumn: 'id', name: 'users' },
        ],
        reverseRelations: [
          { type: 'has-one' as const, fromTable: 'users', toTable: 'users_profile', name: 'profile' },
        ],
        warnings: [],
      }

      const code = generateDrizzleSchema(result)

      // Two separate relation exports for different tables
      expect(code).toContain('export const users_profileRelations')
      expect(code).toContain('export const usersRelations')
    })
  })

  // ============================================
  // End-to-end integration tests
  // ============================================

  describe('parseJsonSchema - warnings', () => {
    it('should return empty warnings array for simple valid schema', () => {
      const schema = {
        title: 'Test',
        type: 'object',
        table: { name: 'test_warnings' },
        properties: {
          id: { type: 'integer', primary: true },
          name: { type: 'string' },
        },
      }
      const validated = JsonSchemaDefinitionSchema.parse(schema)
      const result = parseJsonSchema(validated)

      expect(result.warnings).toBeDefined()
      expect(result.warnings.length).toBe(0)
    })

    it('should warn when deeply nested object has nested.enabled', () => {
      const schema = {
        title: 'User',
        type: 'object',
        table: { name: 'users' },
        properties: {
          id: { type: 'integer', primary: true },
          settings: {
            type: 'object',
            nested: { enabled: true, relation: 'has-one' },
            properties: {
              theme: { type: 'string' },
              advancedConfig: {
                type: 'object',
                nested: { enabled: true, relation: 'has-one' },
                properties: {
                  key: { type: 'string' },
                },
              },
            },
          },
        },
      }
      const validated = JsonSchemaDefinitionSchema.parse(schema)
      const result = parseJsonSchema(validated)

      expect(result.warnings.length).toBe(1)
      expect(result.warnings[0]).toContain('advancedConfig')
      expect(result.warnings[0]).toContain('skipped')
    })

    it('should warn for multiple deeply nested properties', () => {
      const schema = {
        title: 'User',
        type: 'object',
        table: { name: 'users' },
        properties: {
          id: { type: 'integer', primary: true },
          profile: {
            type: 'object',
            nested: { enabled: true, relation: 'has-one' },
            properties: {
              bio: { type: 'string' },
              nested1: {
                type: 'object',
                nested: { enabled: true, relation: 'has-one' },
                properties: { a: { type: 'string' } },
              },
              nested2: {
                type: 'object',
                nested: { enabled: true, relation: 'has-many' },
                properties: { b: { type: 'string' } },
              },
            },
          },
        },
      }
      const validated = JsonSchemaDefinitionSchema.parse(schema)
      const result = parseJsonSchema(validated)

      expect(result.warnings.length).toBe(2)
      expect(result.warnings.some(w => w.includes('nested1'))).toBe(true)
      expect(result.warnings.some(w => w.includes('nested2'))).toBe(true)
    })
  })

  describe('parseJsonSchema - foreign key constraints', () => {
    it('should mark FK column with isForeignKey and foreignKeyRef', () => {
      const schema = {
        title: 'User',
        type: 'object',
        table: { name: 'users' },
        properties: {
          id: { type: 'integer', primary: true },
          profile: {
            type: 'object',
            nested: { enabled: true, relation: 'has-one' },
            properties: {
              bio: { type: 'string' },
            },
          },
        },
      }
      const validated = JsonSchemaDefinitionSchema.parse(schema)
      const result = parseJsonSchema(validated)

      const profileTable = result.tables.find(t => t.name === 'users_profile')
      const fkCol = profileTable?.columns.find(c => c.name === 'users_id')

      expect(fkCol?.isForeignKey).toBe(true)
      expect(fkCol?.foreignKeyRef).toEqual({ table: 'users', column: 'id' })
    })

    it('should not mark non-FK columns as foreign key', () => {
      const schema = {
        title: 'User',
        type: 'object',
        table: { name: 'users' },
        properties: {
          id: { type: 'integer', primary: true },
          name: { type: 'string' },
        },
      }
      const validated = JsonSchemaDefinitionSchema.parse(schema)
      const result = parseJsonSchema(validated)

      const mainTable = result.tables[0]
      const nameCol = mainTable.columns.find(c => c.name === 'name')
      const idCol = mainTable.columns.find(c => c.name === 'id')

      expect(nameCol?.isForeignKey).toBeFalsy()
      expect(idCol?.isForeignKey).toBeFalsy()
    })
  })

  describe('generateDrizzleSchema - foreign key references', () => {
    it('should generate .references() syntax for FK columns', () => {
      const result = {
        tables: [
          { name: 'users', columns: [{ name: 'id', columnType: columnTypeInteger(), isPrimary: true, isAutoIncrement: true, isNullable: false, isUnique: false }] },
          { name: 'users_profile', columns: [
            { name: 'id', columnType: columnTypeInteger(), isPrimary: true, isAutoIncrement: true, isNullable: false, isUnique: false },
            { name: 'users_id', columnType: columnTypeInteger(), isPrimary: false, isAutoIncrement: false, isNullable: false, isUnique: false, isForeignKey: true, foreignKeyRef: { table: 'users', column: 'id' } },
            { name: 'bio', columnType: columnTypeText(), isPrimary: false, isAutoIncrement: false, isNullable: true, isUnique: false },
          ] },
        ],
        relations: [{
          fromTable: 'users_profile',
          fromColumn: 'users_id',
          toTable: 'users',
          toColumn: 'id',
          name: 'users',
        }],
        reverseRelations: [{
          type: 'has-one' as const,
          fromTable: 'users',
          toTable: 'users_profile',
          name: 'profile',
        }],
        warnings: [],
      }

      const code = generateDrizzleSchema(result)

      expect(code).toContain('users_id: integer().notNull().references(() => users.id)')
    })

    it('should generate references with correct arrow function syntax', () => {
      const result = {
        tables: [
          { name: 'posts', columns: [{ name: 'id', columnType: columnTypeInteger(), isPrimary: true, isAutoIncrement: true, isNullable: false, isUnique: false }] },
          { name: 'posts_comments', columns: [
            { name: 'id', columnType: columnTypeInteger(), isPrimary: true, isAutoIncrement: true, isNullable: false, isUnique: false },
            { name: 'posts_id', columnType: columnTypeInteger(), isPrimary: false, isAutoIncrement: false, isNullable: false, isUnique: false, isForeignKey: true, foreignKeyRef: { table: 'posts', column: 'id' } },
          ] },
        ],
        relations: [],
        reverseRelations: [],
        warnings: [],
      }

      const code = generateDrizzleSchema(result)

      // Should use arrow function syntax: references(() => table.column)
      expect(code).toContain('references(() => posts.id)')
    })
  })

  describe('end-to-end: complex e-commerce schema', () => {
    const schemas = createComplexEcommerceSchema()

    it('should validate both schemas', () => {
      const customerResult = JsonSchemaDefinitionSchema.safeParse(schemas.customers)
      const productResult = JsonSchemaDefinitionSchema.safeParse(schemas.products)
      expect(customerResult.success).toBe(true)
      expect(productResult.success).toBe(true)
    })

    it('should parse customer schema into correct tables and relations', () => {
      const validated = JsonSchemaDefinitionSchema.parse(schemas.customers)
      const result = parseJsonSchema(validated)

      // customers + customers_orders + customers_orders_items + customers_address = 4
      // Note: deeply nested items inside orders is skipped (2nd level nesting)
      expect(result.tables.length).toBe(3) // customers, customers_orders, customers_address
      expect(result.relations.length).toBe(2) // orders -> customers, address -> customers
      expect(result.reverseRelations.length).toBe(2)

      const mainTable = result.tables.find(t => t.name === 'customers')
      expect(mainTable?.columns.find(c => c.name === 'id')).toBeDefined()
      expect(mainTable?.columns.find(c => c.name === 'email')).toBeDefined()
      expect(mainTable?.columns.find(c => c.name === 'name')).toBeDefined()
      expect(mainTable?.columns.find(c => c.name === 'credit_balance')).toBeDefined()
      expect(mainTable?.columns.find(c => c.name === 'is_active')).toBeDefined()
      expect(mainTable?.columns.find(c => c.name === 'last_login_at')).toBeDefined()
      expect(mainTable?.columns.find(c => c.name === 'metadata')).toBeDefined()
      expect(mainTable?.columns.find(c => c.name === 'created_at')).toBeDefined()
      expect(mainTable?.columns.find(c => c.name === 'updated_at')).toBeDefined()
      expect(mainTable?.columns.find(c => c.name === 'deleted_at')).toBeDefined()

      // orders is a has-many nested table
      const ordersTable = result.tables.find(t => t.name === 'customers_orders')
      expect(ordersTable).toBeDefined()
      expect(ordersTable?.columns.find(c => c.name === 'customers_id')).toBeDefined()

      // address is a has-one nested table
      const addressTable = result.tables.find(t => t.name === 'customers_address')
      expect(addressTable).toBeDefined()
      expect(addressTable?.columns.find(c => c.name === 'customers_id')).toBeDefined()
    })

    it('should parse product schema correctly', () => {
      const validated = JsonSchemaDefinitionSchema.parse(schemas.products)
      const result = parseJsonSchema(validated)

      expect(result.tables.length).toBe(1)
      expect(result.relations.length).toBe(0)

      const table = result.tables[0]
      expect(table.columns.find(c => c.name === 'sku')?.isUnique).toBe(true)
      expect(table.columns.find(c => c.name === 'tags')?.columnType).toEqual(columnTypeText('json'))
      expect(table.columns.find(c => c.name === 'attributes')?.columnType).toEqual(columnTypeText('json'))
      expect(table.columns.find(c => c.name === 'created_at')).toBeDefined()
      // No softDelete, so no deleted_at
      expect(table.columns.find(c => c.name === 'deleted_at')).toBeUndefined()
    })

    it('should generate valid Drizzle code from customer schema', () => {
      const validated = JsonSchemaDefinitionSchema.parse(schemas.customers)
      const result = parseJsonSchema(validated)
      const code = generateDrizzleSchema(result)

      // Import statements
      expect(code).toContain('import { sqliteTable, text, integer, real } from \'drizzle-orm/sqlite-core\'')
      expect(code).toContain('import { relations } from \'drizzle-orm\'')

      // Table definitions
      expect(code).toContain('export const customers = sqliteTable')
      expect(code).toContain('export const customers_orders = sqliteTable')
      expect(code).toContain('export const customers_address = sqliteTable')

      // Column types
      expect(code).toContain(`integer({ mode: 'timestamp' })`)
      expect(code).toContain(`integer({ mode: 'boolean' })`)
      expect(code).toContain(`text({ mode: 'json' })`)
      expect(code).toContain('real()')

      // Constraints
      expect(code).toContain('.notNull()')
      expect(code).toContain('.unique()')
      expect(code).toContain('.default(')

      // Relations
      expect(code).toContain('export const customers_ordersRelations')
      expect(code).toContain('export const customers_addressRelations')
      expect(code).toContain('export const customersRelations')

      // Verify no duplicate exports
      const exportMatches = code.match(/^export const \w+Relations =/gm)
      const exportNames = exportMatches?.map(m => m.replace('export const ', '').replace(' =', '')) ?? []
      expect(new Set(exportNames).size).toBe(exportNames.length)
    })

    it('should merge multi-file schemas into one Drizzle output', () => {
      // Simulate what the CLI command does
      const allTables: ParsedTable[] = []
      const allRelations: ParsedRelation[] = []
      const allReverseRelations: ParsedReverseRelation[] = []

      for (const schemaDef of Object.values(schemas)) {
        const validated = JsonSchemaDefinitionSchema.parse(schemaDef)
        const result = parseJsonSchema(validated)
        allTables.push(...result.tables)
        allRelations.push(...result.relations)
        allReverseRelations.push(...result.reverseRelations)
      }

      const code = generateDrizzleSchema({
        tables: allTables,
        relations: allRelations,
        reverseRelations: allReverseRelations,
        warnings: [],
      })

      // Both customer and product tables should appear
      expect(code).toContain('export const customers = sqliteTable')
      expect(code).toContain('export const products = sqliteTable')
      expect(code).toContain('export const customers_orders = sqliteTable')
      expect(code).toContain('export const customers_address = sqliteTable')

      // No duplicate table definitions
      const tableExportMatches = code.match(/^export const \w+ = sqliteTable/gm)
      const tableNames = tableExportMatches?.map(m => m.replace('export const ', '').replace(' = sqliteTable', '')) ?? []
      expect(new Set(tableNames).size).toBe(tableNames.length)
    })
  })

  describe('end-to-end: schema with all column types and constraints', () => {
    it('should handle a schema exercising every supported feature', () => {
      const schema = {
        title: 'KitchenSink',
        type: 'object',
        table: { name: 'kitchen_sink', timestamps: true, softDelete: true },
        properties: {
          id: { type: 'integer', primary: true, autoIncrement: true },
          // String types
          name: { type: 'string' },
          slug: { type: 'string', unique: true },
          description: { type: 'string', default: '' },
          eventTime: { type: 'string', format: 'date-time' },
          config: { type: 'string', format: 'json' },
          // Integer types
          count: { type: 'integer', default: 0 },
          flag: { type: 'integer', drizzle: { mode: 'boolean' } },
          ts: { type: 'integer', drizzle: { mode: 'timestamp' } },
          tsMs: { type: 'integer', drizzle: { mode: 'timestamp_ms' } },
          bigNum: { type: 'integer', drizzle: { mode: 'bigint' } },
          // Number
          score: { type: 'number' },
          // Boolean
          active: { type: 'boolean', default: true },
          // Object as JSON
          metadata: { type: 'object', drizzle: { mode: 'json' } },
          rawJson: { type: 'object' },
          // Array as JSON
          tags: { type: 'array' },
          // Null
          placeholder: { type: 'null' },
          // Nested has-one
          detail: {
            type: 'object',
            nested: { enabled: true, relation: 'has-one' },
            properties: {
              info: { type: 'string' },
            },
          },
          // Nested has-many
          logs: {
            type: 'array',
            items: {
              type: 'object',
              nested: { enabled: true, relation: 'has-many' },
              properties: {
                message: { type: 'string' },
                level: { type: 'string', default: 'info' },
              },
            },
          },
        },
        required: ['name', 'slug'],
      }

      const validated = JsonSchemaDefinitionSchema.parse(schema)
      const result = parseJsonSchema(validated)
      const code = generateDrizzleSchema(result)

      // Main table
      const mainTable = result.tables.find(t => t.name === 'kitchen_sink')
      expect(mainTable).toBeDefined()

      // Nested tables
      expect(result.tables.find(t => t.name === 'kitchen_sink_detail')).toBeDefined()
      expect(result.tables.find(t => t.name === 'kitchen_sink_logs')).toBeDefined()

      // Verify column type mappings in generated code
      expect(code).toContain('name: text().notNull()')
      expect(code).toContain('slug: text().notNull().unique()')
      expect(code).toContain(`description: text().default("")`)
      expect(code).toContain(`event_time: integer({ mode: 'timestamp' })`)
      expect(code).toContain(`config: text({ mode: 'json' })`)
      expect(code).toContain(`flag: integer({ mode: 'boolean' })`)
      expect(code).toContain(`ts_ms: integer({ mode: 'timestamp_ms' })`)
      expect(code).toContain(`big_num: integer({ mode: 'bigint' })`)
      expect(code).toContain('score: real()')
      expect(code).toContain(`active: integer({ mode: 'boolean' }).default(true)`)
      expect(code).toContain(`metadata: text({ mode: 'json' })`)
      expect(code).toContain(`raw_json: text({ mode: 'json' })`)
      expect(code).toContain(`tags: text({ mode: 'json' })`)
      expect(code).toContain('placeholder: text()')

      // Timestamps and soft delete
      expect(code).toContain(`created_at: integer({ mode: 'timestamp' }).notNull()`)
      expect(code).toContain(`updated_at: integer({ mode: 'timestamp' }).notNull()`)
      expect(code).toContain(`deleted_at: integer({ mode: 'timestamp' })`)
    })
  })

  describe('parser - check constraint generation', () => {
    it('generates length checks for string minLength/maxLength', () => {
      const schema = {
        title: 'Test',
        type: 'object' as const,
        properties: {
          name: { type: 'string' as const, minLength: 2, maxLength: 100 },
        },
        table: { name: 'test' },
      }
      const validated = JsonSchemaDefinitionSchema.parse(schema)
      const result = parseJsonSchema(validated)
      const table = result.tables[0]
      expect(table.checks).toBeDefined()
      expect(table.checks).toHaveLength(2)
      expect(table.checks![0]).toEqual({ name: 'name_min_length', column: 'name', kind: 'min_length', value: 2 })
      expect(table.checks![1]).toEqual({ name: 'name_max_length', column: 'name', kind: 'max_length', value: 100 })
    })

    it('generates range checks for integer minimum/maximum', () => {
      const schema = {
        title: 'Test',
        type: 'object' as const,
        properties: {
          age: { type: 'integer' as const, minimum: 0, maximum: 150 },
        },
        table: { name: 'test' },
      }
      const validated = JsonSchemaDefinitionSchema.parse(schema)
      const result = parseJsonSchema(validated)
      const table = result.tables[0]
      expect(table.checks).toHaveLength(2)
      expect(table.checks![0]).toEqual({ name: 'age_min', column: 'age', kind: 'min_value', value: 0 })
      expect(table.checks![1]).toEqual({ name: 'age_max', column: 'age', kind: 'max_value', value: 150 })
    })

    it('generates range checks for number minimum/maximum', () => {
      const schema = {
        title: 'Test',
        type: 'object' as const,
        properties: {
          price: { type: 'number' as const, minimum: 0.01, maximum: 9999.99 },
        },
        table: { name: 'test' },
      }
      const validated = JsonSchemaDefinitionSchema.parse(schema)
      const result = parseJsonSchema(validated)
      const table = result.tables[0]
      expect(table.checks).toHaveLength(2)
    })

    it('skips minLength: 0 (always true, no constraint generated)', () => {
      const schema = {
        title: 'Test',
        type: 'object' as const,
        properties: {
          name: { type: 'string' as const, minLength: 0 },
        },
        table: { name: 'test' },
      }
      const validated = JsonSchemaDefinitionSchema.parse(schema)
      const result = parseJsonSchema(validated)
      const table = result.tables[0]
      expect(table.checks).toBeUndefined()
    })

    it('skips checks for boolean, object, array, null types', () => {
      const schema = {
        title: 'Test',
        type: 'object' as const,
        properties: {
          flag: { type: 'boolean' as const },
          meta: { type: 'object' as const, properties: { key: { type: 'string' as const } } },
          tags: { type: 'array' as const, items: { type: 'string' as const } },
          nothing: { type: 'null' as const },
        },
        table: { name: 'test' },
      }
      const validated = JsonSchemaDefinitionSchema.parse(schema)
      const result = parseJsonSchema(validated)
      const table = result.tables[0]
      expect(table.checks).toBeUndefined()
    })

    it('generates checks for nested table columns', () => {
      const schema = {
        title: 'Parent',
        type: 'object' as const,
        properties: {
          child: {
            type: 'object' as const,
            nested: { enabled: true, relation: 'has-one' },
            properties: {
              note: { type: 'string' as const, minLength: 1, maxLength: 500 },
              score: { type: 'integer' as const, minimum: 0 },
            },
          },
        },
        table: { name: 'parent' },
      }
      const validated = JsonSchemaDefinitionSchema.parse(schema)
      const result = parseJsonSchema(validated)
      const childTable = result.tables.find(t => t.name === 'parent_child')
      expect(childTable).toBeDefined()
      expect(childTable!.checks).toBeDefined()
      expect(childTable!.checks).toHaveLength(3)
      expect(childTable!.checks!.some(c => c.name === 'note_min_length')).toBe(true)
      expect(childTable!.checks!.some(c => c.name === 'score_min')).toBe(true)
    })

    it('does not add checks when no constraints are set', () => {
      const schema = {
        title: 'Simple',
        type: 'object' as const,
        properties: {
          name: { type: 'string' as const },
        },
        table: { name: 'simple' },
      }
      const validated = JsonSchemaDefinitionSchema.parse(schema)
      const result = parseJsonSchema(validated)
      const table = result.tables[0]
      expect(table.checks).toBeUndefined()
    })
  })

  describe('generateDrizzleSchema - check constraint emission', () => {
    it('imports check and sql when any table has checks', () => {
      const result = {
        tables: [{
          name: 'users',
          columns: [{ name: 'id', columnType: columnTypeInteger(), isPrimary: true, isAutoIncrement: true, isNullable: false, isUnique: false }],
          checks: [{ name: 'id_min', column: 'id', kind: 'min_value' as const, value: 0 }],
        }],
        relations: [],
        reverseRelations: [],
        warnings: [],
      }
      const code = generateDrizzleSchema(result)
      expect(code).toContain('check, sql')
    })

    it('omits check and sql from import when no checks exist', () => {
      const result = {
        tables: [{
          name: 'users',
          columns: [{ name: 'id', columnType: columnTypeInteger(), isPrimary: true, isAutoIncrement: true, isNullable: false, isUnique: false }],
        }],
        relations: [],
        reverseRelations: [],
        warnings: [],
      }
      const code = generateDrizzleSchema(result)
      expect(code).not.toContain('check, sql')
      expect(code).not.toContain(', (table)')
    })

    it('emits table-level extraConfig with check constraint', () => {
      const result = {
        tables: [{
          name: 'users',
          columns: [
            { name: 'id', columnType: columnTypeInteger(), isPrimary: true, isAutoIncrement: true, isNullable: false, isUnique: false },
            { name: 'name', columnType: columnTypeText(), isPrimary: false, isAutoIncrement: false, isNullable: false, isUnique: false },
          ],
          checks: [{ name: 'name_min_length', column: 'name', kind: 'min_length' as const, value: 2 }],
        }],
        relations: [],
        reverseRelations: [],
        warnings: [],
      }
      const code = generateDrizzleSchema(result)
      expect(code).toContain(', (table) => ({')
      expect(code).toContain(`name_min_length: check('name_min_length', sql\`length(\${table.name}) >= 2\`)`)
    })

    it('emits multiple checks on the same table', () => {
      const result = {
        tables: [{
          name: 'users',
          columns: [
            { name: 'id', columnType: columnTypeInteger(), isPrimary: true, isAutoIncrement: true, isNullable: false, isUnique: false },
            { name: 'name', columnType: columnTypeText(), isPrimary: false, isAutoIncrement: false, isNullable: false, isUnique: false },
            { name: 'age', columnType: columnTypeInteger(), isPrimary: false, isAutoIncrement: false, isNullable: true, isUnique: false },
          ],
          checks: [
            { name: 'name_min_length', column: 'name', kind: 'min_length' as const, value: 2 },
            { name: 'name_max_length', column: 'name', kind: 'max_length' as const, value: 100 },
            { name: 'age_min', column: 'age', kind: 'min_value' as const, value: 0 },
            { name: 'age_max', column: 'age', kind: 'max_value' as const, value: 150 },
          ],
        }],
        relations: [],
        reverseRelations: [],
        warnings: [],
      }
      const code = generateDrizzleSchema(result)
      expect(code).toContain('name_min_length: check(')
      expect(code).toContain('name_max_length: check(')
      expect(code).toContain('age_min: check(')
      expect(code).toContain('age_max: check(')
    })

    it('handles mix of tables with and without checks', () => {
      const result = {
        tables: [
          { name: 'config', columns: [{ name: 'key', columnType: columnTypeText(), isPrimary: true, isAutoIncrement: false, isNullable: false, isUnique: false }] },
          { name: 'users', columns: [{ name: 'name', columnType: columnTypeText(), isPrimary: false, isAutoIncrement: false, isNullable: false, isUnique: false }], checks: [{ name: 'name_min_length', column: 'name', kind: 'min_length' as const, value: 2 }] },
        ],
        relations: [],
        reverseRelations: [],
        warnings: [],
      }
      const code = generateDrizzleSchema(result)
      expect(code).toContain('export const config = sqliteTable(')
      expect(code).toContain('export const users = sqliteTable(')
      expect(code).toContain('(table) => ({')
      expect(code).toContain('name_min_length: check(\'name_min_length\'')
    })

    it('end-to-end: KitchenSink score field generates check constraints', () => {
      const schema = {
        title: 'KitchenSink',
        type: 'object',
        table: { name: 'kitchen_sink' },
        properties: {
          id: { type: 'integer', primary: true, autoIncrement: true },
          name: { type: 'string', minLength: 1, maxLength: 200 },
          score: { type: 'number', default: 0, minimum: 0, maximum: 100 },
          count: { type: 'integer', minimum: 0 },
        },
        required: ['name'],
      }
      const validated = JsonSchemaDefinitionSchema.parse(schema)
      const result = parseJsonSchema(validated)
      const table = result.tables[0]
      expect(table.checks).toBeDefined()
      expect(table.checks!.some(c => c.name === 'name_min_length')).toBe(true)
      expect(table.checks!.some(c => c.name === 'name_max_length')).toBe(true)
      expect(table.checks!.some(c => c.name === 'score_min')).toBe(true)
      expect(table.checks!.some(c => c.name === 'score_max')).toBe(true)
      expect(table.checks!.some(c => c.name === 'count_min')).toBe(true)

      const code = generateDrizzleSchema(result)
      expect(code).toContain('check, sql')
      expect(code).toContain(`sql\`length(\${table.name})`)
      expect(code).toContain(`sql\`\${table.score}`)
      expect(code).toContain(`sql\`\${table.count}`)
    })
  })
})
