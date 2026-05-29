import type { JsonSchemaDefinition } from '@/domain/schema/schemas'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTablesFromSchema } from './sqlite-test-utils'

function makeDb(): Database.Database {
  return new Database(':memory:')
}

let db: Database.Database

beforeEach(() => {
  db = makeDb()
})

afterEach(() => {
  db.close()
})

describe('string minLength CHECK constraint', () => {
  const schema: JsonSchemaDefinition = {
    title: 'Test',
    type: 'object',
    table: { name: 'item' },
    properties: {
      name: { type: 'string', minLength: 3 },
    },
    required: ['name'],
  }

  it('accepts value meeting minLength', () => {
    createTablesFromSchema(db, schema)
    db.prepare(`INSERT INTO item (name) VALUES ('abc')`).run()
    const row = db.prepare('SELECT * FROM item').get() as any
    expect(row.name).toBe('abc')
  })

  it('rejects value below minLength', () => {
    createTablesFromSchema(db, schema)
    expect(() => {
      db.prepare(`INSERT INTO item (name) VALUES ('ab')`).run()
    }).toThrow()
  })

  it('rejects empty string when minLength > 0', () => {
    createTablesFromSchema(db, schema)
    expect(() => {
      db.prepare(`INSERT INTO item (name) VALUES ('')`).run()
    }).toThrow()
  })
})

describe('string maxLength CHECK constraint', () => {
  const schema: JsonSchemaDefinition = {
    title: 'Test',
    type: 'object',
    table: { name: 'item' },
    properties: {
      name: { type: 'string', maxLength: 5 },
    },
    required: ['name'],
  }

  it('accepts value meeting maxLength', () => {
    createTablesFromSchema(db, schema)
    db.prepare(`INSERT INTO item (name) VALUES ('hello')`).run()
  })

  it('rejects value exceeding maxLength', () => {
    createTablesFromSchema(db, schema)
    expect(() => {
      db.prepare(`INSERT INTO item (name) VALUES ('hello!')`).run()
    }).toThrow()
  })
})

describe('integer minimum CHECK constraint', () => {
  const schema: JsonSchemaDefinition = {
    title: 'Test',
    type: 'object',
    table: { name: 'item' },
    properties: {
      age: { type: 'integer', minimum: 0 },
    },
    required: ['age'],
  }

  it('accepts value at minimum boundary', () => {
    createTablesFromSchema(db, schema)
    db.prepare('INSERT INTO item (age) VALUES (0)').run()
  })

  it('accepts value above minimum', () => {
    createTablesFromSchema(db, schema)
    db.prepare('INSERT INTO item (age) VALUES (25)').run()
  })

  it('rejects value below minimum', () => {
    createTablesFromSchema(db, schema)
    expect(() => {
      db.prepare('INSERT INTO item (age) VALUES (-1)').run()
    }).toThrow()
  })
})

describe('integer maximum CHECK constraint', () => {
  const schema: JsonSchemaDefinition = {
    title: 'Test',
    type: 'object',
    table: { name: 'item' },
    properties: {
      age: { type: 'integer', maximum: 150 },
    },
    required: ['age'],
  }

  it('accepts value at maximum boundary', () => {
    createTablesFromSchema(db, schema)
    db.prepare('INSERT INTO item (age) VALUES (150)').run()
  })

  it('rejects value above maximum', () => {
    createTablesFromSchema(db, schema)
    expect(() => {
      db.prepare('INSERT INTO item (age) VALUES (151)').run()
    }).toThrow()
  })
})

describe('number minimum CHECK constraint', () => {
  const schema: JsonSchemaDefinition = {
    title: 'Test',
    type: 'object',
    table: { name: 'item' },
    properties: {
      price: { type: 'number', minimum: 0.01 },
    },
    required: ['price'],
  }

  it('accepts value at minimum boundary', () => {
    createTablesFromSchema(db, schema)
    db.prepare('INSERT INTO item (price) VALUES (0.01)').run()
  })

  it('rejects value below minimum', () => {
    createTablesFromSchema(db, schema)
    expect(() => {
      db.prepare('INSERT INTO item (price) VALUES (0)').run()
    }).toThrow()
  })
})

describe('number maximum CHECK constraint', () => {
  const schema: JsonSchemaDefinition = {
    title: 'Test',
    type: 'object',
    table: { name: 'item' },
    properties: {
      price: { type: 'number', maximum: 9999.99 },
    },
    required: ['price'],
  }

  it('accepts value at maximum boundary', () => {
    createTablesFromSchema(db, schema)
    db.prepare('INSERT INTO item (price) VALUES (9999.99)').run()
  })

  it('rejects value above maximum', () => {
    createTablesFromSchema(db, schema)
    expect(() => {
      db.prepare('INSERT INTO item (price) VALUES (10000)').run()
    }).toThrow()
  })
})

describe('multiple constraints on the same column', () => {
  const schema: JsonSchemaDefinition = {
    title: 'Test',
    type: 'object',
    table: { name: 'item' },
    properties: {
      name: { type: 'string', minLength: 2, maxLength: 10 },
    },
    required: ['name'],
  }

  it('accepts value within both bounds', () => {
    createTablesFromSchema(db, schema)
    db.prepare(`INSERT INTO item (name) VALUES ('hello')`).run()
  })

  it('rejects below minLength even when maxLength is satisifed', () => {
    createTablesFromSchema(db, schema)
    expect(() => {
      db.prepare(`INSERT INTO item (name) VALUES ('x')`).run()
    }).toThrow()
  })

  it('rejects above maxLength even when minLength is satisifed', () => {
    createTablesFromSchema(db, schema)
    expect(() => {
      db.prepare(`INSERT INTO item (name) VALUES ('hello world')`).run()
    }).toThrow()
  })
})

describe('multiple columns with independent constraints', () => {
  const schema: JsonSchemaDefinition = {
    title: 'Test',
    type: 'object',
    table: { name: 'item' },
    properties: {
      name: { type: 'string', minLength: 1 },
      age: { type: 'integer', minimum: 0, maximum: 150 },
      score: { type: 'number', minimum: 0, maximum: 100 },
    },
    required: ['name', 'age', 'score'],
  }

  it('accepts all valid values', () => {
    createTablesFromSchema(db, schema)
    db.prepare(`INSERT INTO item (name, age, score) VALUES ('Alice', 30, 95.5)`).run()
    const row = db.prepare('SELECT * FROM item').get() as any
    expect(row.name).toBe('Alice')
    expect(row.age).toBe(30)
    expect(row.score).toBe(95.5)
  })

  it('rejects when string violates minLength', () => {
    createTablesFromSchema(db, schema)
    expect(() => {
      db.prepare(`INSERT INTO item (name, age, score) VALUES ('', 30, 95.5)`).run()
    }).toThrow()
  })

  it('rejects when integer exceeds maximum', () => {
    createTablesFromSchema(db, schema)
    expect(() => {
      db.prepare(`INSERT INTO item (name, age, score) VALUES ('Alice', 200, 95.5)`).run()
    }).toThrow()
  })

  it('rejects when number is below minimum', () => {
    createTablesFromSchema(db, schema)
    expect(() => {
      db.prepare(`INSERT INTO item (name, age, score) VALUES ('Alice', 30, -0.1)`).run()
    }).toThrow()
  })
})

describe('nested object with CHECK constraints', () => {
  const schema: JsonSchemaDefinition = {
    title: 'Parent',
    type: 'object',
    table: { name: 'parents' },
    properties: {
      id: { type: 'integer', primary: true, autoIncrement: true },
      name: { type: 'string', minLength: 1 },
      child: {
        type: 'object',
        nested: { enabled: true, relation: 'has-one' },
        properties: {
          note: { type: 'string', minLength: 1, maxLength: 500 },
          score: { type: 'integer', minimum: 0 },
        },
      },
    },
    required: ['name'],
  }

  it('creates child table with constraints and accepts valid data', () => {
    createTablesFromSchema(db, schema)
    db.prepare(`INSERT INTO parents (name) VALUES ('Parent1')`).run()
    db.prepare(`INSERT INTO parents_child (note, score, parents_id) VALUES ('Valid note', 42, 1)`).run()
    const row = db.prepare('SELECT * FROM parents_child').get() as any
    expect(row.note).toBe('Valid note')
    expect(row.score).toBe(42)
  })

  it('rejects invalid child data violating minLength', () => {
    createTablesFromSchema(db, schema)
    db.prepare(`INSERT INTO parents (name) VALUES ('Parent1')`).run()
    expect(() => {
      db.prepare(`INSERT INTO parents_child (note, score, parents_id) VALUES ('', 42, 1)`).run()
    }).toThrow()
  })

  it('rejects invalid child data violating integer minimum', () => {
    createTablesFromSchema(db, schema)
    db.prepare(`INSERT INTO parents (name) VALUES ('Parent1')`).run()
    expect(() => {
      db.prepare(`INSERT INTO parents_child (note, score, parents_id) VALUES ('Note', -5, 1)`).run()
    }).toThrow()
  })
})

describe('no CHECK for boolean/object/array/null types', () => {
  const schema: JsonSchemaDefinition = {
    title: 'Test',
    type: 'object',
    table: { name: 'item' },
    properties: {
      flag: { type: 'boolean' },
      meta: { type: 'object', properties: { key: { type: 'string' } } },
      tags: { type: 'array', items: { type: 'string' } },
      nullableVal: { type: 'null' },
    },
  }

  it('creates table without error (no CHECK constraints for these types)', () => {
    createTablesFromSchema(db, schema)
    db.prepare('INSERT INTO item (flag) VALUES (1)').run()
    const row = db.prepare('SELECT * FROM item').get() as any
    expect(row.flag).toBe(1)
  })
})
