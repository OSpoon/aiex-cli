import type { JsonSchemaDefinition } from '@/domain/schema/schemas'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { insertExtractedData } from '@/infrastructure/extraction/insert-extracted-data'
import { createTablesFromSchema } from './sqlite-test-utils'

function makeDb(): Database.Database {
  return new Database(':memory:')
}

// ───────────── Schema fixtures ─────────────

const flatSchema: JsonSchemaDefinition = {
  title: 'Person',
  type: 'object',
  table: { name: 'person' },
  properties: {
    name: { type: 'string' },
    age: { type: 'integer' },
    isActive: { type: 'boolean' },
  },
  required: ['name'],
}

const flatSchemaWithId: JsonSchemaDefinition = {
  title: 'Product',
  type: 'object',
  table: { name: 'products' },
  properties: {
    id: { type: 'integer', primary: true, autoIncrement: true },
    sku: { type: 'string', unique: true },
    name: { type: 'string' },
    price: { type: 'number' },
  },
  required: ['sku', 'name', 'price'],
}

const hasOneSchema: JsonSchemaDefinition = {
  title: 'Employee',
  type: 'object',
  table: { name: 'employees' },
  properties: {
    id: { type: 'integer', primary: true, autoIncrement: true },
    name: { type: 'string' },
    profile: {
      type: 'object',
      nested: { enabled: true, relation: 'has-one' },
      properties: {
        bio: { type: 'string' },
        department: { type: 'string' },
      },
    },
  },
  required: ['name'],
}

const hasManySchema: JsonSchemaDefinition = {
  title: 'Blog',
  type: 'object',
  table: { name: 'blogs' },
  properties: {
    id: { type: 'integer', primary: true, autoIncrement: true },
    title: { type: 'string' },
    posts: {
      type: 'array',
      items: {
        type: 'object',
        nested: { enabled: true, relation: 'has-many' },
        properties: {
          headline: { type: 'string' },
          published: { type: 'boolean' },
        },
      },
    },
  },
  required: ['title'],
}

const combinedSchema: JsonSchemaDefinition = {
  title: 'Customer',
  type: 'object',
  table: { name: 'customers' },
  properties: {
    id: { type: 'integer', primary: true, autoIncrement: true },
    name: { type: 'string' },
    email: { type: 'string', format: 'email' },
    address: {
      type: 'object',
      nested: { enabled: true, relation: 'has-one' },
      properties: {
        street: { type: 'string' },
        city: { type: 'string' },
        zipCode: { type: 'string' },
      },
    },
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
  required: ['name', 'email'],
}

const timestampSchema: JsonSchemaDefinition = {
  title: 'Event',
  type: 'object',
  table: { name: 'events', timestamps: true },
  properties: {
    id: { type: 'integer', primary: true, autoIncrement: true },
    name: { type: 'string' },
  },
  required: ['name'],
}

const softDeleteSchema: JsonSchemaDefinition = {
  title: 'Document',
  type: 'object',
  table: { name: 'documents', timestamps: true, softDelete: true },
  properties: {
    id: { type: 'integer', primary: true, autoIncrement: true },
    title: { type: 'string' },
  },
  required: ['title'],
}

const jsonModeSchema: JsonSchemaDefinition = {
  title: 'Article',
  type: 'object',
  table: { name: 'articles' },
  properties: {
    id: { type: 'integer', primary: true, autoIncrement: true },
    title: { type: 'string' },
    metadata: { type: 'object', drizzle: { mode: 'json' } },
    tags: { type: 'array', items: { type: 'string' } },
  },
  required: ['title'],
}

const schemaWithDefaults: JsonSchemaDefinition = {
  title: 'Config',
  type: 'object',
  table: { name: 'configs' },
  properties: {
    id: { type: 'integer', primary: true, autoIncrement: true },
    key: { type: 'string' },
    enabled: { type: 'boolean', default: true },
    retries: { type: 'integer', default: 3 },
  },
  required: ['key'],
}

// ───────────── Test suite ─────────────

describe('insertExtractedData', () => {
  let db: Database.Database

  beforeEach(() => {
    db = makeDb()
  })

  afterEach(() => {
    db.close()
  })

  describe('flat schema', () => {
    it('inserts a row with all fields', () => {
      createTablesFromSchema(db, flatSchema)
      const result = insertExtractedData(db, flatSchema, {
        name: 'Alice',
        age: 30,
        isActive: true,
      })
      expect(result.success).toBe(true)
      expect(result.tablesInserted).toHaveLength(1)

      const row = db.prepare('SELECT * FROM person').get() as any
      expect(row.name).toBe('Alice')
      expect(row.age).toBe(30)
      expect(row.is_active).toBe(1)
    })

    it('inserts row with optional fields missing', () => {
      createTablesFromSchema(db, flatSchema)
      const result = insertExtractedData(db, flatSchema, { name: 'Bob' })
      expect(result.success).toBe(true)

      const row = db.prepare('SELECT * FROM person').get() as any
      expect(row.name).toBe('Bob')
      expect(row.age).toBeNull()
      expect(row.is_active).toBeNull()
    })

    it('rejects missing required fields (db constraint)', () => {
      createTablesFromSchema(db, flatSchema)
      const result = insertExtractedData(db, flatSchema, { age: 25 })
      expect(result.success).toBe(false)
      expect(result.error).toBeTruthy()
    })

    it('skips auto-increment primary key', () => {
      createTablesFromSchema(db, flatSchemaWithId)
      const result = insertExtractedData(db, flatSchemaWithId, {
        sku: 'ABC-123',
        name: 'Widget',
        price: 9.99,
      })
      expect(result.success).toBe(true)

      const row = db.prepare('SELECT * FROM products').get() as any
      expect(row.id).toBe(1)
      expect(row.sku).toBe('ABC-123')
      expect(row.name).toBe('Widget')
      expect(row.price).toBe(9.99)
    })
  })

  describe('has-one relation', () => {
    it('inserts main row and nested object into separate table', () => {
      createTablesFromSchema(db, hasOneSchema)
      const result = insertExtractedData(db, hasOneSchema, {
        name: 'Charlie',
        profile: { bio: 'Engineer', department: 'Engineering' },
      })
      if (!result.success)
        console.error('has-one error:', result.error)
      expect(result.success).toBe(true)
      expect(result.tablesInserted).toHaveLength(2)

      const emp = db.prepare('SELECT * FROM employees').get() as any
      expect(emp.name).toBe('Charlie')

      const prof = db.prepare('SELECT * FROM employees_profile').get() as any
      expect(prof.bio).toBe('Engineer')
      expect(prof.department).toBe('Engineering')
      expect(prof.employees_id).toBe(emp.id)
    })

    it('handles missing nested object (optional relation)', () => {
      createTablesFromSchema(db, hasOneSchema)
      const result = insertExtractedData(db, hasOneSchema, { name: 'Dave' })
      expect(result.success).toBe(true)
      expect(result.tablesInserted).toHaveLength(1)

      const count = db.prepare('SELECT COUNT(*) as c FROM employees_profile').get() as any
      expect(count.c).toBe(0)
    })
  })

  describe('has-many relation', () => {
    it('inserts main row and multiple nested items', () => {
      createTablesFromSchema(db, hasManySchema)
      const result = insertExtractedData(db, hasManySchema, {
        title: 'Tech Blog',
        posts: [
          { headline: 'Post 1', published: true },
          { headline: 'Post 2', published: false },
          { headline: 'Post 3', published: true },
        ],
      })
      if (!result.success)
        console.error('has-many error:', result.error)
      expect(result.success).toBe(true)
      expect(result.tablesInserted).toHaveLength(4)

      const blog = db.prepare('SELECT * FROM blogs').get() as any
      expect(blog.title).toBe('Tech Blog')

      const posts = db.prepare('SELECT * FROM blogs_posts ORDER BY id').all() as any[]
      expect(posts).toHaveLength(3)
      expect(posts[0].headline).toBe('Post 1')
      expect(posts[0].published).toBe(1)
      expect(posts[1].headline).toBe('Post 2')
      expect(posts[1].published).toBe(0)
      expect(posts[2].headline).toBe('Post 3')
      expect(posts[2].published).toBe(1)
      posts.forEach(p => expect(p.blogs_id).toBe(blog.id))
    })

    it('handles empty array', () => {
      createTablesFromSchema(db, hasManySchema)
      const result = insertExtractedData(db, hasManySchema, {
        title: 'Empty Blog',
        posts: [],
      })
      expect(result.success).toBe(true)
      expect(result.tablesInserted).toHaveLength(1)

      const count = db.prepare('SELECT COUNT(*) as c FROM blogs_posts').get() as any
      expect(count.c).toBe(0)
    })
  })

  describe('combined has-one and has-many', () => {
    it('inserts into all tables with correct FK relationships', () => {
      createTablesFromSchema(db, combinedSchema)
      const result = insertExtractedData(db, combinedSchema, {
        name: 'Alice',
        email: 'alice@example.com',
        address: { street: '123 Main', city: 'Portland', zipCode: '97201' },
        orders: [
          { total: 29.99, status: 'shipped' },
          { total: 59.99 },
        ],
      })
      if (!result.success)
        console.error('combined error:', result.error)
      expect(result.success).toBe(true)
      expect(result.tablesInserted).toHaveLength(4)
      const customer = db.prepare('SELECT * FROM customers').get() as any
      expect(customer.name).toBe('Alice')

      const addr = db.prepare('SELECT * FROM customers_address').get() as any
      expect(addr.street).toBe('123 Main')
      expect(addr.customers_id).toBe(customer.id)

      const orders = db.prepare('SELECT * FROM customers_orders ORDER BY id').all() as any[]
      expect(orders).toHaveLength(2)
      expect(orders[0].total).toBe(29.99)
      expect(orders[0].status).toBe('shipped')
      expect(orders[1].total).toBe(59.99)
      expect(orders[1].status).toBe('pending')
      orders.forEach(o => expect(o.customers_id).toBe(customer.id))
    })
  })

  describe('timestamps', () => {
    it('auto-fills created_at and updated_at', () => {
      createTablesFromSchema(db, timestampSchema)
      const before = Math.floor(Date.now() / 1000)
      const result = insertExtractedData(db, timestampSchema, { name: 'Test Event' })
      const after = Math.floor(Date.now() / 1000)

      expect(result.success).toBe(true)

      const row = db.prepare('SELECT * FROM events').get() as any
      expect(row.name).toBe('Test Event')
      expect(row.created_at).toBeGreaterThanOrEqual(before)
      expect(row.created_at).toBeLessThanOrEqual(after)
      expect(row.updated_at).toBeGreaterThanOrEqual(before)
      expect(row.updated_at).toBeLessThanOrEqual(after)
    })
  })

  describe('soft delete', () => {
    it('sets deleted_at to null', () => {
      createTablesFromSchema(db, softDeleteSchema)
      const result = insertExtractedData(db, softDeleteSchema, { title: 'My Doc' })

      expect(result.success).toBe(true)

      const row = db.prepare('SELECT * FROM documents').get() as any
      expect(row.title).toBe('My Doc')
      expect(row.created_at).toBeTruthy()
      expect(row.updated_at).toBeTruthy()
      expect(row.deleted_at).toBeNull()
    })
  })

  describe('jSON mode columns', () => {
    it('stores objects as JSON text', () => {
      createTablesFromSchema(db, jsonModeSchema)
      const metadata = { author: 'Alice', views: 100, published: true }
      const tags = ['tech', 'database']

      const result = insertExtractedData(db, jsonModeSchema, {
        title: 'My Article',
        metadata,
        tags,
      })
      expect(result.success).toBe(true)

      const row = db.prepare('SELECT * FROM articles').get() as any
      expect(row.title).toBe('My Article')
      expect(JSON.parse(row.metadata)).toEqual(metadata)
      expect(JSON.parse(row.tags)).toEqual(tags)
    })

    it('stores null JSON fields as null', () => {
      createTablesFromSchema(db, jsonModeSchema)
      const result = insertExtractedData(db, jsonModeSchema, { title: 'No Meta' })
      expect(result.success).toBe(true)

      const row = db.prepare('SELECT * FROM articles').get() as any
      expect(row.metadata).toBeNull()
      expect(row.tags).toBeNull()
    })
  })

  describe('default values', () => {
    it('uses schema defaults when data lacks the field', () => {
      createTablesFromSchema(db, schemaWithDefaults)
      const result = insertExtractedData(db, schemaWithDefaults, { key: 'setting1' })
      if (!result.success)
        console.error('defaults error:', result.error)
      expect(result.success).toBe(true)

      const row = db.prepare('SELECT * FROM configs').get() as any
      expect(row.key).toBe('setting1')
      expect(row.enabled).toBe(1)
      expect(row.retries).toBe(3)
    })

    it('overrides defaults with provided data', () => {
      createTablesFromSchema(db, schemaWithDefaults)
      const result = insertExtractedData(db, schemaWithDefaults, {
        key: 'setting2',
        enabled: false,
        retries: 5,
      })
      expect(result.success).toBe(true)

      const row = db.prepare('SELECT * FROM configs').get() as any
      expect(row.key).toBe('setting2')
      expect(row.enabled).toBe(0)
      expect(row.retries).toBe(5)
    })
  })

  describe('transaction rollback', () => {
    it('rolls back main insert when nested insert fails', () => {
      const strictNestedSchema: JsonSchemaDefinition = {
        title: 'Parent',
        type: 'object',
        table: { name: 'parents' },
        properties: {
          id: { type: 'integer', primary: true, autoIncrement: true },
          name: { type: 'string' },
          child: {
            type: 'object',
            nested: { enabled: true, relation: 'has-one' },
            properties: {
              label: { type: 'string', unique: true },
            },
          },
        },
        required: ['name'],
      }
      createTablesFromSchema(db, strictNestedSchema)

      // First insert should succeed
      const r1 = insertExtractedData(db, strictNestedSchema, {
        name: 'First',
        child: { label: 'duplicate' },
      })
      expect(r1.success).toBe(true)

      // Second insert with same unique label should fail and roll back the main insert
      const r2 = insertExtractedData(db, strictNestedSchema, {
        name: 'Second',
        child: { label: 'duplicate' },
      })
      expect(r2.success).toBe(false)

      const parents = db.prepare('SELECT * FROM parents').all() as any[]
      expect(parents).toHaveLength(1)
      expect(parents[0].name).toBe('First')
    })
  })

  describe('type conversions', () => {
    it('converts booleans to 0/1', () => {
      const boolSchema: JsonSchemaDefinition = {
        title: 'Flags',
        type: 'object',
        table: { name: 'flags' },
        properties: {
          id: { type: 'integer', primary: true, autoIncrement: true },
          flag: { type: 'boolean' },
        },
      }
      createTablesFromSchema(db, boolSchema)

      insertExtractedData(db, boolSchema, { flag: true })
      insertExtractedData(db, boolSchema, { flag: false })

      const rows = db.prepare('SELECT * FROM flags ORDER BY id').all() as any[]
      expect(rows[0].flag).toBe(1)
      expect(rows[1].flag).toBe(0)
    })

    it('converts timestamp strings to unix epoch seconds', () => {
      const tsSchema: JsonSchemaDefinition = {
        title: 'Log',
        type: 'object',
        table: { name: 'logs' },
        properties: {
          id: { type: 'integer', primary: true, autoIncrement: true },
          eventTime: { type: 'string', format: 'date-time' },
        },
      }
      createTablesFromSchema(db, tsSchema)

      insertExtractedData(db, tsSchema, { eventTime: '2026-01-15T10:30:00Z' })

      const row = db.prepare('SELECT * FROM logs').get() as any
      expect(row.event_time).toBe(Math.floor(Date.parse('2026-01-15T10:30:00Z') / 1000))
    })

    it('handles bigint mode integers', () => {
      const bigintSchema: JsonSchemaDefinition = {
        title: 'Big',
        type: 'object',
        table: { name: 'bigs' },
        properties: {
          id: { type: 'integer', primary: true, autoIncrement: true },
          bigval: { type: 'integer', drizzle: { mode: 'bigint' } },
        },
      }
      createTablesFromSchema(db, bigintSchema)

      insertExtractedData(db, bigintSchema, { bigval: 9007199254740991 })

      const row = db.prepare('SELECT * FROM bigs').get() as any
      expect(row.bigval).toBe(9007199254740991)
    })
  })

  describe('edge cases', () => {
    it('handles camelCase property names correctly', () => {
      const camelSchema: JsonSchemaDefinition = {
        title: 'CamelCase',
        type: 'object',
        table: { name: 'camel_cases' },
        properties: {
          id: { type: 'integer', primary: true, autoIncrement: true },
          displayName: { type: 'string' },
          lastLoginAt: { type: 'string', format: 'date-time' },
        },
      }
      createTablesFromSchema(db, camelSchema)

      const result = insertExtractedData(db, camelSchema, {
        displayName: 'Alice',
        lastLoginAt: '2026-05-17T00:00:00Z',
      })
      expect(result.success).toBe(true)

      const row = db.prepare('SELECT * FROM camel_cases').get() as any
      expect(row.display_name).toBe('Alice')
      expect(row.last_login_at).toBe(Math.floor(Date.parse('2026-05-17T00:00:00Z') / 1000))
    })

    it('inserts multiple rows sequentially', () => {
      createTablesFromSchema(db, flatSchema)

      for (let i = 0; i < 5; i++) {
        const result = insertExtractedData(db, flatSchema, {
          name: `User ${i}`,
          age: 20 + i,
        })
        expect(result.success).toBe(true)
      }

      const rows = db.prepare('SELECT * FROM person ORDER BY rowid').all() as any[]
      expect(rows).toHaveLength(5)
      expect(rows[0].name).toBe('User 0')
      expect(rows[4].name).toBe('User 4')
    })

    it('preserves row isolation between separate inserts', () => {
      createTablesFromSchema(db, combinedSchema)

      insertExtractedData(db, combinedSchema, {
        name: 'First',
        email: 'first@test.com',
        orders: [{ total: 10.0 }],
      })

      insertExtractedData(db, combinedSchema, {
        name: 'Second',
        email: 'second@test.com',
        orders: [{ total: 20.0 }],
      })

      const customers = db.prepare('SELECT * FROM customers ORDER BY id').all() as any[]
      const orders = db.prepare('SELECT * FROM customers_orders ORDER BY id').all() as any[]

      expect(customers).toHaveLength(2)
      expect(orders).toHaveLength(2)
      expect(orders[0].customers_id).toBe(customers[0].id)
      expect(orders[1].customers_id).toBe(customers[1].id)
    })

    it('rejects data with wrong types', () => {
      const strictSchema: JsonSchemaDefinition = {
        title: 'Strict',
        type: 'object',
        table: { name: 'strict' },
        properties: {
          id: { type: 'integer', primary: true, autoIncrement: true },
          name: { type: 'string' },
        },
        required: ['name'],
      }
      createTablesFromSchema(db, strictSchema)

      const result = insertExtractedData(db, strictSchema, {
        name: null,
      })
      expect(result.success).toBe(false)
    })
  })
})
